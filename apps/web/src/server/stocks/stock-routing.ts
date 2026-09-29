import {
  MAINNET_ASSETS,
  type MainnetStock,
  type StockIssuer,
  type StockVariant,
} from "../networks/chain";
import type { RwaQuote } from "./binance-rwa";

// Each ticker exists as bStocks, Ondo and xStocks tokens with separate liquidity. Quote every
// eligible variant, drop any whose effective price is more than MAX_DEVIATION_BPS worse than
// Binance's reference price for that exact token, or that Binance reports as not trading,
// and pick the one that gives the user the most. Some pools are thin: on 2026-09-29 a
// 1 USDT buy of AAPLx implied ~$2,070 against a ~$340 reference, and would be rejected here.
export const MAX_DEVIATION_BPS = 200n;

export type VariantQuote = { amountIn: bigint; amountOut: bigint };
export type VariantEvaluation = {
  issuer: StockIssuer;
  symbol: string;
  address: `0x${string}`;
  outcome: "chosen" | "fair" | "unfair_price" | "not_trading" | "no_route" | "no_reference";
  amountOut?: bigint;
  deviationBps?: bigint;
};

/**
 * Deviation of the executable price from the reference, in basis points, measured against
 * the user: a buy paying more, or a sell receiving less, than the reference. Both amounts
 * and the reference use 18 decimals (BSC USDT and every stock token have 18).
 */
export function priceDeviationBps(
  side: "buy" | "sell",
  amountIn: bigint,
  amountOut: bigint,
  reference18: bigint,
): bigint {
  if (amountIn <= 0n || amountOut <= 0n || reference18 <= 0n) return 10_000n;
  const scale = 10n ** 18n;
  // Effective USD per token, 18 decimals.
  const effective =
    side === "buy" ? (amountIn * scale) / amountOut : (amountOut * scale) / amountIn;
  const worse = side === "buy" ? effective - reference18 : reference18 - effective;
  return worse <= 0n ? 0n : (worse * 10_000n + reference18 - 1n) / reference18;
}

export async function pickBestVariant(
  ticker: MainnetStock,
  side: "buy" | "sell",
  candidates: readonly StockVariant[],
  quote: (variant: StockVariant) => Promise<VariantQuote>,
  reference: (variant: StockVariant) => Promise<RwaQuote>,
): Promise<{ chosen?: StockVariant & { quote: VariantQuote }; evaluations: VariantEvaluation[] }> {
  const known = MAINNET_ASSETS[ticker].variants.map((v) => v.address.toLowerCase());
  if (candidates.some((v) => !known.includes(v.address.toLowerCase())))
    throw Error("unknown_stock_variant");
  type Result = { variant: StockVariant; q?: VariantQuote; evaluation: VariantEvaluation };
  const results = await Promise.all(
    candidates.map(async (variant): Promise<Result> => {
      const evaluation: VariantEvaluation = {
        issuer: variant.issuer,
        symbol: variant.symbol,
        address: variant.address,
        outcome: "no_reference",
      };
      let ref: RwaQuote;
      try {
        ref = await reference(variant);
      } catch {
        return { variant, evaluation };
      }
      if (!ref.open) return { variant, evaluation: { ...evaluation, outcome: "not_trading" } };
      let q: VariantQuote;
      try {
        q = await quote(variant);
      } catch {
        return { variant, evaluation: { ...evaluation, outcome: "no_route" } };
      }
      if (q.amountOut <= 0n) return { variant, evaluation: { ...evaluation, outcome: "no_route" } };
      const deviationBps = priceDeviationBps(side, q.amountIn, q.amountOut, ref.price);
      const outcome: VariantEvaluation["outcome"] =
        deviationBps <= MAX_DEVIATION_BPS ? "fair" : "unfair_price";
      return {
        variant,
        q,
        evaluation: { ...evaluation, outcome, amountOut: q.amountOut, deviationBps },
      };
    }),
  );
  let best: Result | undefined;
  for (const r of results)
    if (r.evaluation.outcome === "fair" && r.q && (!best?.q || r.q.amountOut > best.q.amountOut))
      best = r;
  if (best) best.evaluation = { ...best.evaluation, outcome: "chosen" };
  return {
    chosen: best?.q ? { ...best.variant, quote: best.q } : undefined,
    evaluations: results.map((r) => r.evaluation),
  };
}

/** One line per variant for review details and logs, e.g. "AAPLx: rejected, 507% above fair price". */
export function describeEvaluation(e: VariantEvaluation, side: "buy" | "sell") {
  const pct = (bps: bigint) => `${bps / 100n}.${(bps % 100n).toString().padStart(2, "0")}%`;
  switch (e.outcome) {
    case "chosen":
      return `${e.symbol} (${e.issuer}): best fair price`;
    case "fair":
      return `${e.symbol} (${e.issuer}): fair, but less ${side === "buy" ? "stock" : "USDT"}`;
    case "unfair_price":
      return `${e.symbol} (${e.issuer}): rejected, ${pct(e.deviationBps ?? 0n)} ${side === "buy" ? "above" : "below"} fair price`;
    case "not_trading":
      return `${e.symbol} (${e.issuer}): not trading right now`;
    case "no_route":
      return `${e.symbol} (${e.issuer}): no liquidity route`;
    case "no_reference":
      return `${e.symbol} (${e.issuer}): no reference price`;
  }
}
