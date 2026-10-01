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

test("company facts combine underlying data and daily candles into a chat reply", async (t) => {
  const saved = { ...process.env };
  process.env.BINANCE_WEB3_API_KEY = "key";
  process.env.BINANCE_WEB3_API_SECRET = "secret";
  const { stockProfileReply } = await import("../src/server/whatsapp/mainnet-stocks");
  const { sparkline } = await import("../src/server/stocks/binance-web3");
  // Shapes and values from the live probe on 1 October 2026 (AAPLB).
  const closes = [342.0795, 339.5916, 341.1391, 338.5816, 328.9617, 334.7943, 333.8145];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (String(url).includes("/rwa/underlying-market"))
      return Response.json({
        code: 0,
        data: {
          marketData: {
            high52W: "345.3400",
            low52W: "243.4200",
            marketCap: "4860153823600.00",
            peRatioTTM: "37.7000",
            dividendYield: "0.00320000",
          },
        },
      });
    // Deliberately newest first: the reply must sort by timestamp.
    return Response.json({
      code: 0,
      data: closes
        .map((c, i) => [
          i === 0 ? 337.5148 : closes[i - 1],
          0,
          0,
          c,
          0,
          1790294400000 + i * 864e5,
          1,
        ])
        .reverse(),
    });
  });
  try {
    const reply = (await stockProfileReply("AAPL")) as { text: { body: string } };
    const body = reply.text.body;
    assert.match(body, /Apple \(AAPL\)/);
    assert.match(body, /Past 7 days: \$337\.51 → \$333\.81 \(−1\.10%\)/);
    assert.match(body, /52-week range: \$243\.42 – \$345\.34/);
    assert.match(body, /Market cap: \$4\.86T/);
    assert.match(body, /P\/E \(TTM\): 37\.7/);
    assert.match(body, /Dividend yield: 0\.32%/);
    assert.ok(body.includes(sparkline(closes)));
    assert.equal(sparkline([1, 2, 3]), "▁▅█");
  } finally {
    process.env = saved;
  }
});

test("a compliance block pauses keyed calls instead of retrying per stock", async (t) => {
  const saved = { ...process.env };
  process.env.BINANCE_WEB3_API_KEY = "key";
  process.env.BINANCE_WEB3_API_SECRET = "secret";
  const { web3Request, resetWeb3Pause } = await import("../src/server/stocks/binance-web3");
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return Response.json({
      code: 40304,
      msg: "Service not available due to compliance restriction",
    });
  });
  try {
    resetWeb3Pause();
    const first = await web3Request("GET", "/api/v1/dex/market/rwa/price");
    assert.equal((first.body as { code: number }).code, 40304);
    await assert.rejects(web3Request("GET", "/api/v1/dex/market/rwa/price"), /unavailable/);
    assert.equal(calls, 1, "no second network call while paused");
  } finally {
    resetWeb3Pause();
    process.env = saved;
  }
});

test("Binance's aggregated quote is a display-only benchmark for our route", async (t) => {
  const saved = { ...process.env };
  process.env.BINANCE_WEB3_API_KEY = "key";
  process.env.BINANCE_WEB3_API_SECRET = "secret";
  const { aggregatedQuote, describeBenchmark, resetWeb3Pause } = await import(
    "../src/server/stocks/binance-web3"
  );
  const usdt = "0x55d398326f99059fF775485246999027B3197955";
  const aaplb = "0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a";
  const oneUsdt = 10n ** 18n;
  // Live probe, 1 October 2026: two vendors; the larger output wins.
  t.mock.method(globalThis, "fetch", async (url: string) => {
    const q = new URL(String(url)).searchParams;
    assert.equal(q.get("fromTokenAddress"), usdt);
    assert.equal(q.get("toTokenAddress"), aaplb);
    return Response.json({
      code: 0,
      data: [
        {
          vendorName: "Other",
          fromTokenAmount: "1000000000000000000",
          toTokenAmount: "2900000000000000",
        },
        {
          vendorName: "LiquidMesh",
          fromTokenAmount: "1000000000000000000",
          toTokenAmount: "2984382419713991",
          dexRouterList: [{ dexProtocol: { dexName: "Uniswap V4", percent: "100.00" } }],
        },
      ],
    });
  });
  try {
    resetWeb3Pause();
    const b = await aggregatedQuote(usdt, aaplb, oneUsdt);
    assert.deepEqual(b, { vendor: "LiquidMesh", dex: "Uniswap V4", amountOut: "2984382419713991" });
    // KyberSwap's route for the same buy on 29 September: 0.00296473 AAPLB.
    assert.equal(
      describeBenchmark(2964730000000000n, b),
      "Binance’s best quote gives 0.65% more (LiquidMesh)",
    );
    assert.equal(
      describeBenchmark(2984382419713991n, b),
      "✓ Matches or beats Binance’s best quote",
    );
    await assert.rejects(aggregatedQuote(usdt, aaplb, oneUsdt + 1n), /invalid_response/);
  } finally {
    resetWeb3Pause();
    process.env = saved;
  }
});
