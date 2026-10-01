import assert from "node:assert/strict";
import test from "node:test";
import { MAINNET_STOCK_TOKENS } from "../src/server/networks/chain";

test("the price list uses one keyed price call for all stocks, within the rate limit", async (t) => {
  const saved = { ...process.env };
  process.env.BINANCE_WEB3_API_KEY = "key";
  process.env.BINANCE_WEB3_API_SECRET = "secret";
  const { mainnetReferencePriceReply } = await import("../src/server/whatsapp/mainnet-stocks");
  const calls: Record<string, number> = {};
  const byAddress = new Map(MAINNET_STOCK_TOKENS.map((v) => [v.address.toLowerCase(), v]));
  t.mock.method(console, "warn", () => undefined);
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(String(input));
    const path = url.pathname.split("/").slice(-2).join("/");
    calls[path] = (calls[path] ?? 0) + 1;
    if (path === "rwa/price") {
      const addresses = url.searchParams.get("tokenContractAddresses")!.split(",");
      return Response.json({
        code: 0,
        data: addresses.map((a) => ({
          binanceChainId: "56",
          tokenContractAddress: a,
          platformId: byAddress.get(a)?.issuer === "xStocks" ? null : "bstock",
          referencePrice: "100.5",
          tokenPriceUpdatedAt: 1,
        })),
      });
    }
    if (path === "market/price-info") return Response.json({ code: 0, data: [] });
    const v = byAddress.get(url.searchParams.get("contractAddress")!.toLowerCase())!;
    return Response.json({
      code: "000000",
      success: true,
      data: {
        symbol: v.symbol,
        ticker: v.ticker,
        tokenInfo: { price: "999" },
        statusInfo: { openState: true },
      },
    });
  });
  try {
    const reply = (await mainnetReferencePriceReply()) as { text: { body: string } };
    assert.equal(calls["rwa/price"], 1, "one batched call for 27 tokens");
    assert.equal(calls["market/price-info"], 1);
    assert.equal((reply.text.body.match(/\$100\.50/g) ?? []).length, 9);
  } finally {
    process.env = saved;
  }
});
