import assert from "node:assert/strict";
import test from "node:test";
import { web3Signature } from "../src/server/stocks/binance-web3";

test("request signatures match the official Binance Web3 connector", () => {
  // Reference value computed with binance-common's web3_signature (Python) for the same input.
  const query = new URLSearchParams({ binanceChainId: "56", tokenContractAddress: "0xabc" });
  assert.equal(
    web3Signature(
      "secret",
      "2026-10-01T08:00:00.123Z",
      "GET",
      "/api/v1/dex/market/candles",
      query.toString(),
      "",
    ),
    "sdRMCM8y/DH+Jxt17qHtoLYMhTlf4gzuLBbsVA/WUPY=",
  );
});

test("reference prices come from one keyed call per stock, xStocks use the bStocks price", async (t) => {
  const saved = { ...process.env };
  process.env.BINANCE_WEB3_API_KEY = "key";
  process.env.BINANCE_WEB3_API_SECRET = "secret";
  const { MAINNET_ASSETS } = await import("../src/server/networks/chain");
  const { rwaTokenQuote, toFixed18 } = await import("../src/server/stocks/binance-rwa");
  const [b, on, x] = MAINNET_ASSETS.AAPL.variants;
  const [tb] = MAINNET_ASSETS.TSLA.variants;
  let keyedCalls = 0;
  // Rows as returned by the live API on 1 October 2026.
  const rows = [
    { platformId: "bstock", address: b.address, ref: "334.657898" },
    { platformId: "ondo", address: on.address, ref: "334.547183" },
    { platformId: null, address: x.address, ref: "340.130854773880343971531273340675384911" },
  ];
  t.mock.method(console, "warn", () => undefined);
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = String(input);
    if (url.startsWith("https://web3.binance.com/build/api/v1/dex/market/rwa/price")) {
      keyedCalls++;
      if (url.includes(tb.address)) return new Response("busy", { status: 503 });
      return Response.json({
        code: 0,
        msg: "success",
        data: rows.map((r) => ({
          binanceChainId: "56",
          tokenContractAddress: r.address,
          platformId: r.platformId,
          tokenPrice: r.ref,
          referencePrice: r.ref,
          tokenPriceUpdatedAt: 1790833943701,
        })),
      });
    }
    const ticker = url.includes(tb.address) ? "TSLA" : "AAPL";
    return Response.json({
      code: "000000",
      success: true,
      data: {
        symbol: "X",
        ticker,
        tokenInfo: { price: "999" },
        statusInfo: { openState: true, reasonCode: "TRADING", marketStatus: null },
      },
    });
  });
  try {
    const [qb, qon, qx] = await Promise.all([b, on, x].map((v) => rwaTokenQuote(v.address)));
    assert.equal(keyedCalls, 1, "one batched keyed call for three issuers");
    assert.equal(qb.price, toFixed18("334.657898"));
    assert.equal(qb.source, "web3_api");
    assert.equal(qon.price, toFixed18("334.547183"));
    assert.equal(qx.price, toFixed18("334.657898"), "stale xStocks price replaced by bStocks");
    const qt = await rwaTokenQuote(tb.address);
    assert.equal(qt.price, toFixed18("999"), "keyed failure falls back to the public price");
    assert.equal(qt.source, "public");
  } finally {
    process.env = saved;
  }
});

test("24h change sends the array body Binance expects and formats for chat", async (t) => {
  const saved = { ...process.env };
  process.env.BINANCE_WEB3_API_KEY = "key";
  process.env.BINANCE_WEB3_API_SECRET = "secret";
  const { marketChanges24h, formatChange24h } = await import("../src/server/stocks/binance-web3");
  const address = "0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a";
  let sent: unknown;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.match(String(url), /\/build\/api\/v1\/dex\/market\/price-info$/);
    assert.equal(init.method, "POST");
    sent = JSON.parse(String(init.body));
    return Response.json({
      code: 0,
      msg: "success",
      data: [{ tokenContractAddress: address, priceChange24H: "1.519" }],
    });
  });
  try {
    const changes = await marketChanges24h([address.toUpperCase().replace("0X", "0x")]);
    assert.deepEqual(sent, [{ binanceChainId: "56", tokenContractAddress: address }]);
    assert.equal(formatChange24h(changes.get(address)), "▲ 1.52% (24h)");
    assert.equal(formatChange24h(-0.4), "▼ 0.40% (24h)");
    assert.equal(formatChange24h(undefined), "");
  } finally {
    process.env = saved;
  }
});
