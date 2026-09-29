import { mainnetPolicyRules } from "../src/server/stocks/mainnet-policy";
import { PrivyClient } from "@privy-io/node";
import { whatsappConfig } from "../src/server/whatsapp/config";
import { WhatsAppStore } from "../src/server/whatsapp/store";
import { MAINNET_EXECUTION_READY } from "../src/server/networks/chain";
import { type MainnetWallet } from "../src/server/stocks/mainnet-orders";

// Read-only provider verification. Never creates resources, signs or broadcasts.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
async function main() {
  const config = whatsappConfig();
  const store = new WhatsAppStore(config.key);
  try {
    const wallets = store.db
      .prepare(
        "SELECT w.* FROM wa_mainnet_wallets w JOIN wa_accounts a ON a.id=w.account_id WHERE a.status='active'",
      )
      .all() as MainnetWallet[];
    if (!wallets.length) throw Error("No dedicated mainnet wallet configured");
    const client = new PrivyClient({
      appId: process.env.PRIVY_APP_ID!,
      appSecret: process.env.PRIVY_APP_SECRET!,
      maxRetries: 0,
      timeout: 15000,
      logLevel: "off",
    });
    const draft = { rules: mainnetPolicyRules() };
    const ruleKeys = (rules: { action: string; method: string; conditions: unknown[] }[]) =>
      rules
        .map((r) =>
          canonical({
            action: r.action,
            method: r.method,
            conditions: r.conditions.map(canonical).sort(),
          }),
        )
        .sort();
    for (const local of wallets) {
      if (
        local.app_id !== process.env.PRIVY_APP_ID ||
        local.owner_id !== process.env.PRIVY_WALLET_OWNER_ID ||
        local.policy_id !== process.env.PRIVY_MAINNET_POLICY_ID
      )
        throw Error("Local wallet configuration mismatch");
      const [wallet, policy] = await Promise.all([
        client.wallets().get(local.provider_id),
        client.policies().get(local.policy_id),
      ]);
      if (
        wallet.address.toLowerCase() !== local.address.toLowerCase() ||
        wallet.external_id !== local.external_id ||
        wallet.owner_id !== local.owner_id ||
        wallet.chain_type !== "ethereum" ||
        wallet.policy_ids.length !== 1 ||
        wallet.policy_ids[0] !== local.policy_id
      )
        throw Error("Provider wallet identity or policy mismatch");
      if (
        policy.owner_id !== local.owner_id ||
        policy.chain_type !== "ethereum" ||
        policy.version !== "1.0" ||
        canonical(ruleKeys(policy.rules)) !== canonical(ruleKeys(draft.rules))
      )
        throw Error("Provider policy differs from prepared rules or ABI");
      console.log(
        "Verified dedicated wallet identity, owner and exact mainnet policy rules:",
        wallet.address,
      );
    }
    console.log("Execution validation complete:", MAINNET_EXECUTION_READY);
    console.log("No provider changes or transactions submitted.");
  } finally {
    store.close();
  }
}
main().catch(() => {
  console.error(
    "Mainnet setup verification failed. Check provider availability and wallet/policy configuration. No secrets logged or transactions submitted.",
  );
  process.exitCode = 1;
});
