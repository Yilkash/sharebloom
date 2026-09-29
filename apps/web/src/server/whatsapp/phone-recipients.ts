import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { senderLookup } from "./config";
import { text } from "./menu";
const VERSION = "steward-phone-visibility-v1";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export function migratePhoneRecipients(db: DatabaseSync) {
  db.exec(`
 CREATE TABLE IF NOT EXISTS wa_phone_visibility_consents (
 token_hash TEXT PRIMARY KEY,account_id TEXT NOT NULL,version TEXT NOT NULL,enable INTEGER NOT NULL,
 expires INTEGER NOT NULL,consumed INTEGER,message_id TEXT);
 CREATE TABLE IF NOT EXISTS wa_phone_lookup_attempts(account_id TEXT NOT NULL,created INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS wa_phone_lookup_account ON wa_phone_lookup_attempts(account_id,created);
`);
}
export function normalizePhone(input: string) {
  if (!/^\+?[0-9 ()-]+$/.test(input.trim())) return null;
  const digits = input.replace(/[+ ()-]/g, "");
  return /^[1-9][0-9]{7,14}$/.test(digits) ? digits : null;
}
function buttons(body: string, choices: { id: string; title: string }[]) {
  return {
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: body },
      action: { buttons: choices.map((reply) => ({ type: "reply", reply })) },
    },
  };
}
export function phoneSettings(db: DatabaseSync, account: string, input: string, messageId: string) {
  const row = db
    .prepare("SELECT phone_lookup FROM wa_accounts WHERE id=? AND status='active'")
    .get(account) as { phone_lookup: number } | undefined;
  if (!row) return text("Create your Sharebloom account before changing this setting.");
  const match = /^phoneprivacy:(confirm|cancel):([a-f0-9]{48})$/.exec(input);
  if (match) {
    const consent = db
      .prepare(
        "SELECT enable FROM wa_phone_visibility_consents WHERE token_hash=? AND account_id=? AND version=? AND consumed IS NULL AND expires>?",
      )
      .get(hash(match[2]), account, VERSION, Date.now()) as { enable: number } | undefined;
    if (!consent)
      return text(
        "This setting confirmation expired or was already used. Open Help & settings again.",
      );
    db.prepare(
      "UPDATE wa_phone_visibility_consents SET consumed=?,message_id=? WHERE token_hash=? AND consumed IS NULL",
    ).run(Date.now(), messageId, hash(match[2]));
    if (match[1] === "cancel") return text("Phone-number visibility was not changed.");
    db.prepare("UPDATE wa_accounts SET phone_lookup=? WHERE id=? AND status='active'").run(
      consent.enable,
      account,
    );
    return text(
      consent.enable
        ? "Phone-number payments are enabled. Sharebloom users who know your full WhatsApp number can find your wallet address and send Demo USD to it. You can turn this off in Help & settings."
        : "Phone-number payments are off. Your number will no longer resolve to your wallet for new lookups. Existing reviewed payments and saved wallet addresses are unaffected.",
    );
  }
  if (input === "phoneprivacy:enable" || input === "phoneprivacy:disable") {
    const enable = input.endsWith(":enable");
    db.prepare(
      "UPDATE wa_phone_visibility_consents SET consumed=? WHERE account_id=? AND consumed IS NULL",
    ).run(Date.now(), account);
    const token = randomBytes(24).toString("hex");
    db.prepare(
      "INSERT INTO wa_phone_visibility_consents(token_hash,account_id,version,enable,expires) VALUES(?,?,?,?,?)",
    ).run(hash(token), account, VERSION, enable ? 1 : 0, Date.now() + 600000);
    return buttons(
      enable
        ? "Allow payments to your WhatsApp number?\n\nOther Sharebloom users who enter your full number will be able to see your wallet address and send Demo USD to it. Your balance and payment history stay private. This does not authorize anyone to spend from your wallet.\n\nYou can turn this off later. Confirmation expires in 10 minutes."
        : "Turn off phone-number payments?\n\nNew lookups will stop finding your wallet. This cannot hide an address someone already knows or cancel an already reviewed payment.",
      [
        { id: "phoneprivacy:confirm:" + token, title: enable ? "Enable lookup" : "Disable lookup" },
        { id: "phoneprivacy:cancel:" + token, title: "Cancel" },
      ],
    );
  }
  if (input.startsWith("phoneprivacy:"))
    return text("This setting action is invalid. Open Help & settings again.");
  return buttons(
    `Help & settings\n\nPhone-number payments: ${row.phone_lookup ? "ON" : "OFF"}\n\nThis setting controls whether other Sharebloom users can find your wallet by entering your full WhatsApp number.\n\nPayments use USDT on BNB Chain. Limit: 1,000 USDT per payment. Transfers require your confirmation. Never share a private key.`,
    [
      {
        id: row.phone_lookup ? "phoneprivacy:disable" : "phoneprivacy:enable",
        title: row.phone_lookup ? "Turn lookup off" : "Turn lookup on",
      },
    ],
  );
}
export function resolvePhoneRecipient(
  db: DatabaseSync,
  key: Buffer,
  requester: string,
  phone: string,
) {
  const now = Date.now();
  db.prepare("DELETE FROM wa_phone_lookup_attempts WHERE created<?").run(now - 3600000);
  const attempts = db
    .prepare("SELECT count(*) n FROM wa_phone_lookup_attempts WHERE account_id=? AND created>?")
    .get(requester, now - 3600000) as { n: number };
  if (attempts.n >= 20) return { limited: true as const };
  db.prepare("INSERT INTO wa_phone_lookup_attempts(account_id,created) VALUES(?,?)").run(
    requester,
    now,
  );
  const row = db
    .prepare(
      `SELECT w.address FROM wa_accounts a JOIN wa_managed_wallets w ON w.account_id=a.id
 WHERE a.sender=? AND a.status='active' AND a.phone_lookup=1 AND w.chain=46630`,
    )
    .get(senderLookup(phone, key)) as { address: string } | undefined;
  return row ? { address: row.address, name: "+" + phone } : null;
}
