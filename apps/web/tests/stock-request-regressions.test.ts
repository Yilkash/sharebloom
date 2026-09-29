import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mainnetStockMentions } from "../src/server/stocks/stock-language";
import { fetchMainnetRoute } from "../src/server/stocks/kyber-route";
import { migrateAccounts } from "../src/server/whatsapp/accounts";
import { currentTask, runAssistantTool } from "../src/server/whatsapp/assistant-tools";

afterEach(() => mock.restoreAll());

for (const name of ["Apple", "apples", "Apple's", "Apple’s", "AAPL"]) {
  test(`stock request recognises ${name} and preserves its 0.2 USDT budget`, async () => {
    const db = new DatabaseSync(":memory:");
    const key = Buffer.alloc(32, 3);
    const enabled = process.env.MAINNET_STOCK_TRADING_ENABLED;
    process.env.MAINNET_STOCK_TRADING_ENABLED = "false";
    mock.method(globalThis, "fetch", async () => {
      throw Error("unexpected network access");
    });
    try {
      migrateAccounts(db);
      const input = `I want ${name} shares worth 0.2 usdg`;
      await runAssistantTool(
        db,
        key,
        "test-account",
        "15550001111",
        "message",
        "consent",
        input,
        input,
        "prepare_mainnet_stock_trade",
        { symbol: "AAPL", side: "buy", amount: "0.2", unit: "USDT" },
      );
      const draft = currentTask(db, key, "test-account", "consent");
      assert.equal(draft?.mainnetSymbol, "AAPL");
      assert.equal(draft?.side, "buy");
      assert.equal(draft?.amount, "0.2");
      assert.equal(draft?.unit, "USDT");
      assert.equal(draft?.desiredQuantity, undefined);
      assert.equal(
        (db.prepare("SELECT count(*) AS n FROM wa_mainnet_orders").get() as { n: number }).n,
        0,
      );
    } finally {
      db.close();
      if (enabled === undefined) delete process.env.MAINNET_STOCK_TRADING_ENABLED;
      else process.env.MAINNET_STOCK_TRADING_ENABLED = enabled;
    }
  });
}

test("aliases preserve boundaries and identify ambiguous multiple stocks", () => {
  assert.deepEqual(mainnetStockMentions("pineapples Appleton AAPLs TeslaXYZ"), []);
  assert.deepEqual(mainnetStockMentions("Apple and Tesla"), ["AAPL", "TSLA"]);
  assert.deepEqual(mainnetStockMentions("NVIDIA's shares"), ["NVDA"]);
});

const query = new URLSearchParams({ amountIn: "200000" });
for (const status of [429, 502, 503, 504]) {
  test(`read-only quote retries HTTP ${status} once`, async () => {
    let calls = 0;
    mock.method(console, "warn", () => undefined);
    mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => {
      assert.match(
        String(url),
        /^https:\/\/aggregator-api\.kyberswap\.com\/bsc\/api\/v1\/routes\?/,
      );
      assert.ok(!init?.method || init.method === "GET");
      calls++;
      return calls === 1 ? new Response(null, { status }) : Response.json({ code: 0 });
    });
    assert.equal((await fetchMainnetRoute(query)).status, 200);
    assert.equal(calls, 2);
  });
}
test("continued overload stops after two GETs and reports busy", async () => {
  let calls = 0;
  mock.method(console, "warn", () => undefined);
  mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response(null, { status: 503 });
  });
  await assert.rejects(fetchMainnetRoute(query), /route_busy/);
  assert.equal(calls, 2);
});
test("nontransient HTTP failures are not retried", async () => {
  let calls = 0;
  mock.method(console, "warn", () => undefined);
  mock.method(globalThis, "fetch", async () => {
    calls++;
    return new Response(null, { status: 400 });
  });
  await assert.rejects(fetchMainnetRoute(query), /route_unavailable/);
  assert.equal(calls, 1);
});
test("network failure retries only the quote lookup", async () => {
  let calls = 0;
  mock.method(console, "warn", () => undefined);
  mock.method(globalThis, "fetch", async () => {
    calls++;
    throw Error("network timeout");
  });
  await assert.rejects(fetchMainnetRoute(query), /route_unavailable/);
  assert.equal(calls, 2);
});
