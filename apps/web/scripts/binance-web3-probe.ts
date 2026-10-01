import dns from "node:dns";
import { MAINNET_ASSETS, MAINNET_QUOTE } from "../src/server/networks/chain";
import { binanceWeb3Configured, web3Request } from "../src/server/stocks/binance-web3";

// Read-only probe of the Binance Web3 Wallet API: one call per endpoint Sharebloom may use.
// Prints status, latency, rate-limit headers and a trimmed body. Never prints credentials.
// Usage: railway run npx tsx scripts/binance-web3-probe.ts

// Some ISPs do not resolve Binance domains; for this probe only, ask a public resolver.
const resolver = new dns.Resolver();
resolver.setServers(["1.1.1.1", "8.8.8.8"]);
const systemLookup = dns.lookup;
(dns as { lookup: unknown }).lookup = (host: string, options: unknown, callback: unknown) => {
  const cb = (typeof options === "function" ? options : callback) as (
    e: Error | null,
    address?: unknown,
    family?: number,
  ) => void;
  const opts = (typeof options === "object" && options) || {};
  if (!/(^|\.)binance\.com$/.test(host))
    return (systemLookup as (...a: unknown[]) => void)(host, options, callback);
  resolver.resolve4(host, (error, addresses) => {
    if (error || !addresses.length)
      return (systemLookup as (...a: unknown[]) => void)(host, options, callback);
    if ((opts as { all?: boolean }).all)
      return cb(
        null,
        addresses.map((address) => ({ address, family: 4 })),
      );
    cb(null, addresses[0], 4);
  });
};

const trim = (value: unknown, max = 1500) => {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 1);
  return text.length > max ? `${text.slice(0, max)}… (${text.length} chars)` : text;
};

async function show(label: string, run: () => ReturnType<typeof web3Request>) {
  try {
    const r = await run();
    console.log(`\n=== ${label}\nHTTP ${r.status} in ${r.ms} ms`);
    if (Object.keys(r.rateLimits).length) console.log("rate limits:", r.rateLimits);
    console.log(trim(r.body));
    return r;
  } catch (error) {
    console.log(`\n=== ${label}\nfailed: ${error instanceof Error ? error.message : "unknown"}`);
  }
}

async function main() {
  if (!binanceWeb3Configured()) {
    console.log("Set BINANCE_WEB3_API_KEY and BINANCE_WEB3_API_SECRET first (Railway variables).");
    process.exitCode = 1;
    return;
  }
  const apple = MAINNET_ASSETS.AAPL.variants;
  if (process.argv.includes("--smoke")) {
    // The new features end to end, printing what a WhatsApp user would see.
    const { rwaTokenQuote } = await import("../src/server/stocks/binance-rwa");
    const { mainnetReferencePriceReply, stockProfileReply } = await import(
      "../src/server/whatsapp/mainnet-stocks"
    );
    for (const v of apple) {
      const q = await rwaTokenQuote(v.address);
      console.log(
        `${v.symbol}: reference ${Number(q.price) / 1e18} from ${q.source}, open ${q.open}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1200));
    console.log("\n--- What are the prices?\n" + (await mainnetReferencePriceReply()).text.body);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    console.log("\n--- Tell me about Apple\n" + (await stockProfileReply("AAPL")).text.body);
    // Best-execution check: our KyberSwap route against Binance's aggregated quote.
    const { previewRoute } = await import("../src/server/stocks/mainnet");
    const { aggregatedQuote, describeBenchmark } = await import(
      "../src/server/stocks/binance-web3"
    );
    const oneUsdt = 10n ** BigInt(MAINNET_QUOTE.decimals);
    for (const v of apple.filter((x) => x.issuer !== "xStocks")) {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const [kyber, binance] = await Promise.all([
        previewRoute(MAINNET_QUOTE.address, v.address, oneUsdt),
        aggregatedQuote(MAINNET_QUOTE.address, v.address, oneUsdt),
      ]);
      console.log(
        `\n--- Buy ${v.symbol} with 1 USDT\nKyberSwap: ${Number(kyber.amountOut) / 1e18}\nBinance:   ${Number(BigInt(binance.amountOut)) / 1e18} via ${binance.vendor} (${binance.dex ?? "?"})\nReview line: ${describeBenchmark(kyber.amountOut, binance)}`,
      );
    }
    return;
  }
  if (process.argv.includes("--list")) {
    // Why are some tokens missing from the default list? Try each filter once.
    for (const extra of [
      { platformId: "bstock" },
      { platformId: "xstock" },
      { tabId: "1" },
      { tabId: "2" },
      { tabId: "3" },
    ] as Record<string, string>[]) {
      await new Promise((resolve) => setTimeout(resolve, 400)); // stay under the rate limit
      const r = await web3Request("GET", "/api/v1/dex/market/rwa/tokens", {
        binanceChainId: "56",
        ...extra,
      }).catch(() => undefined);
      const data =
        (r?.body as { data?: Record<string, unknown>[]; code?: number; msg?: string }) ?? {};
      const rows = data.data ?? [];
      const found = apple
        .filter((v) =>
          rows.some((x) => String(x.tokenContractAddress ?? "").toLowerCase() === v.address),
        )
        .map((v) => v.symbol);
      const platforms = [...new Set(rows.map((x) => String(x.platformId)))].join(",");
      console.log(
        `${JSON.stringify(extra)} → HTTP ${r?.status} code ${data.code} ${data.msg ?? ""} · ${rows.length} rows · platforms: ${platforms} · Apple found: ${found.join(",") || "none"}`,
      );
    }
    return;
  }
  const [aaplB] = apple;
  const addresses = apple.map((v) => v.address).join(",");
  const chain = { binanceChainId: "56" };

  const list = await show("RWA Data · token list (chain 56)", () =>
    web3Request("GET", "/api/v1/dex/market/rwa/tokens", chain),
  );
  const rows = ((list?.body as { data?: unknown[] })?.data ?? []) as Record<string, unknown>[];
  const ours = rows.filter((r) =>
    apple.some((v) => v.address === String(r.tokenContractAddress ?? "").toLowerCase()),
  );
  console.log(`rows: ${rows.length}; Apple variants found: ${ours.length}`);
  console.log(trim(ours, 3000));

  await show("RWA Data · token price (3 Apple variants)", () =>
    web3Request("GET", "/api/v1/dex/market/rwa/price", {
      ...chain,
      tokenContractAddresses: addresses,
    }),
  );
  await show("RWA Data · underlying market (AAPLB)", () =>
    web3Request("GET", "/api/v1/dex/market/rwa/underlying-market", {
      ...chain,
      tokenContractAddress: aaplB.address,
    }),
  );
  await show("Market · candles (AAPLB, 1d x 7)", () =>
    web3Request("GET", "/api/v1/dex/market/candles", {
      ...chain,
      tokenContractAddress: aaplB.address,
      bar: "1d",
      limit: "7",
    }),
  );
  // The official connectors send no body here; try the likely shapes.
  for (const [name, body] of [
    ["array", [{ binanceChainId: "56", tokenContractAddress: aaplB.address }]],
    ["object", { binanceChainId: "56", tokenContractAddresses: [aaplB.address] }],
    ["none", undefined],
  ] as const)
    await show(`Market · price-info (body: ${name})`, () =>
      web3Request("POST", "/api/v1/dex/market/price-info", {}, body),
    );
  await show("Trading · aggregated quote (1 USDT -> AAPLB)", () =>
    web3Request("GET", "/api/v1/dex/aggregator/quote", {
      ...chain,
      amount: (10n ** BigInt(MAINNET_QUOTE.decimals)).toString(),
      fromTokenAddress: MAINNET_QUOTE.address,
      toTokenAddress: aaplB.address,
    }),
  );
}
main().catch((error: unknown) => {
  console.error("Probe stopped:", error instanceof Error ? error.message : "unknown");
  process.exitCode = 1;
});
