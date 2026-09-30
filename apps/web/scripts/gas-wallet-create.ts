import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrivyClient } from "@privy-io/node";
import { formatEther, toHex } from "viem";
import { GAS_TOPUP_DEFAULT_WEI } from "../src/server/stocks/gas-topup";
type PolicyCreateParams = Parameters<ReturnType<PrivyClient["policies"]>["create"]>[0];

// Explicit setup command only. Creates the welcome top-up wallet and its policy; sends nothing.
// The policy lets this wallet send on chain 56 only, at most one top-up of BNB per transaction.
// It only ever holds BNB, so a misused request can take at most one top-up at a time.
async function main() {
  const appId = process.env.PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  const owner = process.env.PRIVY_WALLET_OWNER_ID;
  if (!appId || !appSecret || !owner) throw Error("privy_configuration_missing");
  if (process.env.GAS_TOPUP_WALLET_ID?.trim()) {
    console.log("Top-up wallet already configured; no changes made.");
    return;
  }
  const statePath = resolve(".gas-wallet-setup.json");
  const state: {
    policyKey: string;
    walletKey: string;
    policyId?: string;
    walletId?: string;
    address?: string;
  } = existsSync(statePath)
    ? JSON.parse(readFileSync(statePath, "utf8"))
    : { policyKey: randomUUID(), walletKey: randomUUID() };
  const save = () => writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });
  save();

  const client = new PrivyClient({
    appId,
    appSecret,
    maxRetries: 0,
    timeout: 15000,
    logLevel: "off",
  });
  if (!state.policyId) {
    const policy = {
      name: "Sharebloom gas top-up",
      version: "1.0",
      chain_type: "ethereum",
      rules: [
        {
          name: "Send a BNB top-up",
          method: "eth_sendTransaction",
          action: "ALLOW",
          conditions: [
            {
              field_source: "ethereum_transaction",
              field: "chain_id",
              operator: "eq",
              value: "56",
            },
            {
              field_source: "ethereum_transaction",
              field: "value",
              operator: "lte",
              value: toHex(GAS_TOPUP_DEFAULT_WEI),
            },
          ],
        },
      ],
    } as unknown as PolicyCreateParams;
    const created = await client.policies().create({
      ...policy,
      owner_id: owner,
      idempotency_key: `sharebloom-gas-policy-${state.policyKey}`,
    });
    state.policyId = created.id;
    save();
  }
  if (!state.walletId) {
    const wallet = await client.wallets().create({
      chain_type: "ethereum",
      owner_id: owner,
      policy_ids: [state.policyId],
      external_id: "sharebloom_gas_topup",
      idempotency_key: `sharebloom-gas-wallet-${state.walletKey}`,
    });
    state.walletId = wallet.id;
    state.address = wallet.address;
    save();
  }
  console.log(
    [
      "Top-up wallet ready. Nothing was sent.",
      "",
      `GAS_TOPUP_WALLET_ID=${state.walletId}`,
      `GAS_TOPUP_WALLET_ADDRESS=${state.address}`,
      "",
      `Each top-up is ${formatEther(GAS_TOPUP_DEFAULT_WEI)} BNB. Fund the address with BNB on BNB Smart Chain (BEP20).`,
    ].join("\n"),
  );
}
main().catch((error: unknown) => {
  const e = error as { status?: number; message?: string };
  if (typeof e.status === "number") {
    console.error("Provider HTTP status:", e.status);
    if (typeof e.message === "string")
      console.error("Provider message:", e.message.replace(/[^\x20-\x7e]/g, "").slice(0, 600));
  } else if (error instanceof Error && /^[a-z_]{1,60}$/.test(error.message))
    console.error("Setup check:", error.message);
  console.error("Top-up wallet setup did not finish. Nothing was sent. It is safe to run again.");
  process.exitCode = 1;
});
