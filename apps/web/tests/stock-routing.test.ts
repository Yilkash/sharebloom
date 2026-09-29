import assert from "node:assert/strict";
import test from "node:test";
import { MAINNET_ASSETS, type StockVariant } from "../src/server/networks/chain";
import { toFixed18, type RwaQuote } from "../src/server/stocks/binance-rwa";
import {
  describeEvaluation,
  pickBestVariant,
  priceDeviationBps,
} from "../src/server/stocks/stock-routing";

const e18 = 10n ** 18n;
const aapl = MAINNET_ASSETS.AAPL.variants;
const bySymbol = (s: string) => aapl.find((v) => v.symbol === s)!;
// Live observations for a 1 USDT buy on BSC, 2026-09-29 (KyberSwap amountOut, Binance price).
const observed: Record<string, { out: bigint; ref: string; open?: boolean }> = {
  AAPLB: { out: 2964730000000000n, ref: "337.0134016053337" },
  AAPLon: { out: 2936270000000000n, ref: "337.672170352239" },
  AAPLx: { out: 483005000000000n, ref: "340.1308547738803" },
};
const reference = async (v: StockVariant): Promise<RwaQuote> => ({
  symbol: v.symbol,
  ticker: "AAPL",
  price: toFixed18(observed[v.symbol].ref),
  open: observed[v.symbol].open ?? true,
  reason: null,
  marketStatus: null,
  readAt: Date.now(),
});
const quote = async (v: StockVariant) => ({ amountIn: e18, amountOut: observed[v.symbol].out });

test("decimal prices convert to 18-decimal integers without floating point", () => {
  assert.equal(toFixed18("337.01"), 337_010000000000000000n);
  assert.equal(toFixed18("340.130854773880343971531273340675"), 340_130854773880343971n);
  assert.equal(toFixed18("5"), 5n * e18);
});

test("deviation is measured against the user on both sides", () => {
  const ref = 100n * e18;
  assert.equal(priceDeviationBps("buy", 100n * e18, 1n * e18, ref), 0n);
  assert.equal(priceDeviationBps("buy", 102n * e18, 1n * e18, ref), 200n);
  assert.equal(priceDeviationBps("buy", 99n * e18, 1n * e18, ref), 0n);
  assert.equal(priceDeviationBps("sell", 1n * e18, 97n * e18, ref), 300n);
  assert.equal(priceDeviationBps("sell", 1n * e18, 101n * e18, ref), 0n);
  assert.equal(priceDeviationBps("buy", e18, 0n, ref), 10_000n);
});

test("the thin xStocks pool is rejected and the best fair issuer is chosen", async () => {
  const result = await pickBestVariant("AAPL", "buy", aapl, quote, reference);
  assert.equal(result.chosen?.symbol, "AAPLB");
  const outcome = Object.fromEntries(result.evaluations.map((e) => [e.symbol, e.outcome]));
  assert.deepEqual(outcome, { AAPLB: "chosen", AAPLon: "fair", AAPLx: "unfair_price" });
  const rejected = result.evaluations.find((e) => e.symbol === "AAPLx")!;
  assert.ok((rejected.deviationBps ?? 0n) > 50_000n);
  assert.match(
    describeEvaluation(rejected, "buy"),
    /AAPLx \(xStocks\): rejected, .*above fair price/,
  );
});

test("a halted token, a failed quote or a missing reference is skipped", async () => {
  observed.AAPLB.open = false;
  try {
    const failing = async (v: StockVariant) => {
      if (v.symbol === "AAPLon") throw Error("route_unavailable");
      return quote(v);
    };
    const result = await pickBestVariant("AAPL", "buy", aapl, failing, reference);
    assert.equal(result.chosen, undefined);
    const outcome = Object.fromEntries(result.evaluations.map((e) => [e.symbol, e.outcome]));
    assert.deepEqual(outcome, { AAPLB: "not_trading", AAPLon: "no_route", AAPLx: "unfair_price" });
    const noRef = await pickBestVariant("AAPL", "buy", [bySymbol("AAPLon")], quote, async () => {
      throw Error("source_unavailable");
    });
    assert.equal(noRef.evaluations[0].outcome, "no_reference");
  } finally {
    delete observed.AAPLB.open;
  }
});

test("only variants of the requested ticker are accepted", async () => {
  const tsla = MAINNET_ASSETS.TSLA.variants[0];
  await assert.rejects(
    pickBestVariant("AAPL", "buy", [tsla], quote, reference),
    /unknown_stock_variant/,
  );
});
