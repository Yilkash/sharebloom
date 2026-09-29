import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { text } from "./menu";
import { migrateWalletNotices } from "./wallet-notices";

const VERSION = "steward-wallet-setup-v1";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function walletSetupEnabled() {
  return process.env.PRIVY_WALLET_CREATION_ENABLED === "true";
}
export function walletConfiguration() {
  const app = process.env.PRIVY_APP_ID?.trim();
  const owner = process.env.PRIVY_WALLET_OWNER_ID?.trim();
  const policy = process.env.PRIVY_WALLET_POLICY_ID?.trim();
  if (!app || !owner || !policy) throw new Error("wallet_configuration_missing");
  return { app, owner, policy };
}
export function migrateWalletSetup(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wa_wallet_setup_consents (
      token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, sender TEXT NOT NULL,
      version TEXT NOT NULL, expires INTEGER NOT NULL, consumed INTEGER, outcome TEXT
    );
    CREATE TABLE IF NOT EXISTS wa_wallet_provisioning (
      account_id TEXT PRIMARY KEY, app_id TEXT NOT NULL, owner_id TEXT NOT NULL,
      policy_id TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'queued',
      lease TEXT, lease_until INTEGER, next_check INTEGER NOT NULL DEFAULT 0,
      submitted_at INTEGER, error TEXT, consent_at INTEGER NOT NULL,
      consent_message_id TEXT NOT NULL, consent_version TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS wa_managed_wallets (
      account_id TEXT PRIMARY KEY, provider_id TEXT NOT NULL UNIQUE,
      address TEXT NOT NULL UNIQUE, chain INTEGER NOT NULL CHECK(chain=46630),
      app_id TEXT NOT NULL, owner_id TEXT NOT NULL, policy_id TEXT NOT NULL,
      external_id TEXT NOT NULL UNIQUE, created INTEGER NOT NULL
    );
  `);
  migrateWalletNotices(db);
}
export function walletAddress(db: DatabaseSync, accountId: string) {
  return db.prepare("SELECT address FROM wa_managed_wallets WHERE account_id=?").get(accountId) as
    | { address: string }
    | undefined;
}
export function readyAccount(address: string) {
  return text(
    `Your Sharebloom test wallet is ready.\n\nNetwork: Robinhood Chain testnet\nWallet address:\n${address}\n\nOnly use Robinhood testnet assets here. Demo USD has no monetary value. Wallet setup does not add funds. Choose View balance to see your funds, or Send payment to review a Demo USD transfer.\n\nType Menu to return.`,
  );
}
// Called only inside the inbox transaction. No network operations here.
export function walletSetupReply(
  db: DatabaseSync,
  sender: string,
  accountId: string,
  input: string,
  messageId: string,
) {
  const ready = walletAddress(db, accountId);
  if (ready) return readyAccount(ready.address);
  const job = db
    .prepare("SELECT state FROM wa_wallet_provisioning WHERE account_id=?")
    .get(accountId) as { state: string } | undefined;
  if (job)
    return text(
      job.state === "blocked"
        ? "Wallet setup needs an operator check. Your request is saved. Type Menu to return."
        : "Your wallet setup is in progress. I’ll send your address here automatically when it’s ready.",
    );
  if (!walletSetupEnabled())
    return text(
      "Your Sharebloom test account is active. Wallet setup is pending while the wallet connection is prepared. No wallet address is available yet. Type Menu to return.",
    );
  if (input.startsWith("walletsetup:")) {
    const match = /^walletsetup:(accept|cancel):([a-f0-9]{48})$/.exec(input);
    const consent =
      match &&
      db
        .prepare(
          "SELECT token_hash FROM wa_wallet_setup_consents WHERE token_hash=? AND account_id=? AND sender=? AND version=? AND consumed IS NULL AND expires>?",
        )
        .get(hash(match[2]), accountId, sender, VERSION, Date.now());
    if (!match || !consent)
      return text(
        "This wallet confirmation expired or was already used. Choose My account for a new one.",
      );
    db.prepare("UPDATE wa_wallet_setup_consents SET consumed=?,outcome=? WHERE token_hash=?").run(
      Date.now(),
      match[1],
      hash(match[2]),
    );
    if (match[1] === "cancel")
      return text(
        "Wallet setup cancelled. Your test account remains available. Type Menu to return.",
      );
    const config = walletConfiguration();
    db.prepare(
      "INSERT INTO wa_wallet_provisioning(account_id,app_id,owner_id,policy_id,consent_at,consent_message_id,consent_version) VALUES(?,?,?,?,?,?,?)",
    ).run(accountId, config.app, config.owner, config.policy, Date.now(), messageId, VERSION);
    db.prepare("UPDATE wa_accounts SET wallet_state='queued' WHERE id=?").run(accountId);
    return text("Setting up your test wallet. I’ll send the address here as soon as it’s ready.");
  }
  // A separate consent is needed because the earlier account disclosure deferred wallet creation.
  walletConfiguration();
  db.prepare(
    "UPDATE wa_wallet_setup_consents SET consumed=?,outcome='superseded' WHERE account_id=? AND consumed IS NULL",
  ).run(Date.now(), accountId);
  const token = randomBytes(24).toString("hex");
  db.prepare(
    "INSERT INTO wa_wallet_setup_consents(token_hash,account_id,sender,version,expires) VALUES(?,?,?,?,?)",
  ).run(hash(token), accountId, sender, VERSION, Date.now() + 10 * 60000);
  return {
    type: "interactive",
    interactive: {
      type: "button",
      body: {
        text: "Your account is ready. Next, set up your test wallet.\n\nPrivy will create and protect the wallet's private key. Sharebloom controls this wallet through its authorization key. Access to this WhatsApp account gives access to your Sharebloom account.\n\nThe wallet is for Robinhood Chain testnet. Demo USD has no monetary value. Creating it does not add funds or enable payments. Phone-number recipient lookup stays off.\n\nContinue to create the wallet? This confirmation expires in 10 minutes.",
      },
      action: {
        buttons: [
          {
            type: "reply",
            reply: { id: "walletsetup:accept:" + token, title: "Set up test wallet" },
          },
          { type: "reply", reply: { id: "walletsetup:cancel:" + token, title: "Cancel" } },
        ],
      },
    },
  };
}
