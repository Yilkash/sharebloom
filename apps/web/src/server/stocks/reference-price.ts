import { MAINNET_ASSETS, type MainnetStock } from "../networks/chain";
import { BinanceRwaError, rwaTokenQuote } from "./binance-rwa";

// Display-only data. Order preparation uses per-variant prices through stock-routing.ts.
// The per-token price comes from Binance's RWA data for the ticker's first listed variant
// that answers (bStocks, then Ondo, then xStocks); issuers track the same underlying stock.
const CACHE_MS = 15_000;
const FALLBACK_MS = 5 * 60_000;

export class ReferencePriceError extends Error {
  constructor(
    public readonly code:
      | "source_unavailable"
      | "provider_busy"
      | "invalid_data"
      | "asset_changed"
      | "trading_halted",
  ) {
    super(code);
  }
}
const codeOf = (error: unknown): ReferencePriceError["code"] =>
  error instanceof ReferencePriceError
    ? error.code
    : error instanceof BinanceRwaError && error.code !== "not_listed"
      ? error.code
      : "source_unavailable";
const transient = (error: unknown) =>
  ["source_unavailable", "provider_busy"].includes(codeOf(error));

export type ReferencePrice = {
  symbol: MainnetStock;
  value: bigint;
  decimals: number;
  currency: "USD";
  source: "Binance";
  variant: string;
  marketOpen: boolean;
  asOf: number;
  readAt: number;
  cachedFallback: boolean;
};
const prices = new Map<MainnetStock, ReferencePrice>();
const pending = new Map<MainnetStock, Promise<ReferencePrice>>();

async function readPrice(symbol: MainnetStock): Promise<ReferencePrice> {
  let lastError: unknown = new ReferencePriceError("source_unavailable");
  for (const variant of MAINNET_ASSETS[symbol].variants) {
    try {
      const q = await rwaTokenQuote(variant.address);
      if (q.symbol !== variant.symbol || q.ticker !== symbol)
        throw new ReferencePriceError("asset_changed");
      return {
        symbol,
        value: q.price,
        decimals: 18,
        currency: "USD",
        source: "Binance",
        variant: variant.symbol,
        marketOpen: q.open,
        asOf: q.readAt,
        readAt: Date.now(),
        cachedFallback: false,
      };
    } catch (error) {
      if (codeOf(error) === "asset_changed") throw error;
      lastError = error;
    }
  }
  throw lastError;
}

async function refresh(symbol: MainnetStock): Promise<ReferencePrice> {
  try {
    const result = await readPrice(symbol);
    prices.set(symbol, result);
    return result;
  } catch (error) {
    const saved = prices.get(symbol);
    console.warn("Stock reference refresh failed", { symbol, code: codeOf(error) });
    if (transient(error) && saved && Date.now() - saved.readAt <= FALLBACK_MS)
      return { ...saved, cachedFallback: true };
    prices.delete(symbol);
    throw new ReferencePriceError(codeOf(error));
  }
}

export async function mainnetReferencePrice(symbol: MainnetStock, forceRefresh = false) {
  const saved = prices.get(symbol);
  if (!forceRefresh && saved && Date.now() - saved.readAt < CACHE_MS) return saved;
  let work = pending.get(symbol);
  if (!work) {
    work = refresh(symbol).finally(() => {
      pending.delete(symbol);
    });
    pending.set(symbol, work);
  }
  return work;
}

/** Integer rounding for display; never use floating point to scale a price. */
export function referenceDollars(value: bigint, decimals: number) {
  const scale = 10n ** BigInt(decimals);
  const cents = (value * 100n + scale / 2n) / scale;
  if (value > 0n && cents === 0n) return "< $0.01";
  return `$${cents / 100n}.${(cents % 100n).toString().padStart(2, "0")}`;
}
