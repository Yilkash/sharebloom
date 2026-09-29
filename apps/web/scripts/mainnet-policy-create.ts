import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { PrivyClient } from "@privy-io/node";
import { mainnetPolicyRules } from "../src/server/stocks/mainnet-policy";
type PolicyCreateParams = Parameters<ReturnType<PrivyClient["policies"]>["create"]>[0];

// Explicit setup command only. Creates an unattached policy; never sends a transaction.
async function main() {
  const appId = process.env.PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  const owner = process.env.PRIVY_WALLET_OWNER_ID;
  if (!appId || !appSecret || !owner) throw Error("privy_configuration_missing");
  if (process.env.PRIVY_MAINNET_POLICY_ID?.trim()) {
    console.log("Mainnet policy already configured; no changes made.");
    return;
  }
  // The policy is generated from the configured BNB Chain token list (27 stock variants + USDT).
  const raw = JSON.stringify({
    name: "Sharebloom BNB Chain trades",
    version: "1.0",
    chain_type: "ethereum",
    rules: mainnetPolicyRules(),
  });
  const template = JSON.parse(raw) as PolicyCreateParams;
  const digest = createHash("sha256")
    .update(appId + owner + raw)
    .digest("hex");
  const statePath = resolve(".mainnet-policy-setup.json");
  let state: { digest: string; submittedAt: number; id?: string };
  if (existsSync(statePath)) {
    state = JSON.parse(readFileSync(statePath, "utf8"));
    if (state.digest !== digest) throw Error("policy_setup_configuration_changed");
    if (
      !state.id &&
      (!process.argv.includes("--recover") || Date.now() - state.submittedAt >= 23 * 60 * 60 * 1000)
    )
      throw Error("policy_creation_uncertain_check_privy_dashboard");
  } else {
    state = { digest, submittedAt: Date.now() };
    writeFileSync(statePath, JSON.stringify(state), { flag: "wx", mode: 0o600 });
  }
  if (!state.id) {
    const client = new PrivyClient({
      appId,
      appSecret,
      maxRetries: 0,
      timeout: 15000,
      logLevel: "off",
    });
    const policy = await client.policies().create({
      ...template,
      owner_id: owner,
      idempotency_key: `sharebloom-bsc-policy-${digest}`,
    });
    state.id = policy.id;
    writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });
  }
  if (!state.id || !/^[A-Za-z0-9_-]+$/.test(state.id)) throw Error("invalid_policy_id");
  const envPath = resolve(".env.local");
  const env = readFileSync(envPath, "utf8");
  const line = `PRIVY_MAINNET_POLICY_ID=${state.id}`;
  writeFileSync(
    envPath,
    /^PRIVY_MAINNET_POLICY_ID=.*$/m.test(env)
      ? env.replace(/^PRIVY_MAINNET_POLICY_ID=.*$/m, line)
      : env.trimEnd() + "\n" + line + "\n",
    { mode: 0o600 },
  );
  console.log(
    "Separate mainnet policy created and its ID saved locally. No wallet policy was changed; trading remains disabled.",
  );
}
main().catch((error: unknown) => {
  const e = error as { status?: number; error?: { code?: string; message?: string } };
  if (typeof e.status === "number") console.error("Provider HTTP status:", e.status);
  if (typeof e.error?.code === "string" && /^[a-zA-Z0-9_ -]{1,100}$/.test(e.error.code))
    console.error("Provider error code:", e.error.code);
  console.error(
    "Policy setup did not finish. No transactions were submitted. If .mainnet-policy-setup.json has no ID, check Privy before retrying; the request may have succeeded.",
  );
  process.exitCode = 1;
});
