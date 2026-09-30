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
