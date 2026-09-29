import type { DatabaseSync } from "node:sqlite";
import { actionFor, text } from "./menu";
import { paymentReply } from "./payments";

export function migratePaymentLanguage(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS wa_payment_language_entries(
    account_id TEXT PRIMARY KEY, amount TEXT NOT NULL, expires INTEGER NOT NULL
  )`);
}

// Local intent rules: no messages or draft history leave Sharebloom.
// All requests feed the existing review/confirmation flow, never submission.
export function paymentLanguageReply(
  db: DatabaseSync,
  key: Buffer,
  account: string,
  message: { from: string; input: string; id: string; timestamp?: number },
) {
  const input = message.input.trim().replace(/^\//, "");
  // IDs are protocol commands, never natural-language payment requests.
  if (/^(?:menu|pay|paycontact|contact|phoneprivacy|walletsetup|enroll|servchat):/.test(input))
    return null;
  const entry = db
    .prepare("SELECT stage,expires FROM wa_payment_sessions WHERE account_id=?")
    .get(account) as { stage: string; expires: number } | undefined;
  const remembered = db
    .prepare("SELECT amount,expires FROM wa_payment_language_entries WHERE account_id=?")
    .get(account) as { amount: string; expires: number } | undefined;
  const clear = () =>
    db.prepare("DELETE FROM wa_payment_language_entries WHERE account_id=?").run(account);
  if (remembered) {
    if (
      !entry ||
      entry.expires <= Date.now() ||
      remembered.expires <= Date.now() ||
      actionFor(input) ||
      /^(?:menu|cancel|help|settings|send|hi|hello|start)$/i.test(input) ||
      /^(?:pay|contact|phoneprivacy|walletsetup|enroll|servchat):/.test(input)
    ) {
      clear();
    } else if (entry.stage === "address") {
      const selected = paymentReply(db, key, message);
      const next = db
        .prepare("SELECT stage FROM wa_payment_sessions WHERE account_id=?")
        .get(account) as { stage: string } | undefined;
      if (next?.stage === "amount") {
        clear();
        return paymentReply(db, key, { ...message, input: remembered.amount });
      }
      return selected;
    } else clear();
  }
  if (entry && entry.expires > Date.now()) return null;
  const intent =
    /^(?:(?:please|pls|plz)\s+|(?:can|could)\s+you\s+|(?:i\s+want\s+to|i'd\s+like\s+to)\s+)*(send|pay|transfer)\b\s*(.*)$/i.exec(
      input,
    );
  if (!intent) return null;
  let body = intent[2].trim().replace(/\s+(?:please|pls)\s*$/i, "");
  if (/(?<![a-z])(?:usdc|usdt|usdg|eth|btc|eur|gbp|ngn|naira|mainnet)(?![a-z])/i.test(body))
    return text(
      "This wallet supports Demo USD on Robinhood testnet. Please specify a Demo USD payment; no payment was prepared.",
    );
  body = body.replace(/\bfrom\s+(?:my\s+(?:steward\s+)?wallet|me)\b/gi, "").trim();
  if (/\bfrom\b/i.test(body))
    return text(
      "I can only prepare a payment from your own Sharebloom wallet. Tell me the recipient and amount. Nothing was sent.",
    );
  if (/\b(?:not|don't|dont|never|instead|or|and|except)\b|[?]/i.test(body))
    return text(
      "Please give one recipient and one amount to prepare a payment review. Nothing was sent.",
    );
  if (!body || body.toLowerCase() === "payment")
    return paymentReply(db, key, { ...message, input: "Send payment" });
  const number = "(?:[0-9]+(?:\\.[0-9]{1,6})?|\\.[0-9]{1,6})";
  const money = "\\$?(" + number + ")(?:\\s*(?:demo\\s*usd|dusd|usd))?";
  let amount: string | undefined;
  let recipient: string | undefined;
  const directRecipient = body.replace(/^to\s+/i, "").trim();
  if (/^(?:0x[a-f0-9]{40}|\+?[1-9]\d{7,14})$/i.test(directRecipient)) {
    recipient = directRecipient;
  } else {
    let match = new RegExp("^" + money + "\\s+(?:to\\s+)?(.+)$", "i").exec(body);
    if (match) {
      amount = match[1];
      recipient = match[2];
    } else {
      match = new RegExp("^(?:to\\s+)?(.+?)\\s+(?:amount\\s+)?" + money + "$", "i").exec(body);
      if (match) {
        recipient = match[1];
        amount = match[2];
      } else {
        match = new RegExp("^" + money + "$", "i").exec(body);
        // Long numbers without a currency are recipients, not payment amounts.
        if (match && (match[1].length <= 7 || /usd|\$/i.test(body))) amount = match[1];
        else recipient = body.replace(/^to\s+/i, "").trim();
      }
    }
  }
  if (amount) {
    amount = amount.startsWith(".") ? "0" + amount : amount;
    if (
      !/^(?:0|[1-9]\d{0,3})(?:\.\d{1,6})?$/.test(amount) ||
      Number(amount) <= 0 ||
      Number(amount) > 1000
    )
      return text(
        "Enter one amount above 0 and up to 1,000 Demo USD, with at most 6 decimal places. Nothing was sent.",
      );
  }
  const start = paymentReply(db, key, { ...message, input: "Send payment" });
  const started = db
    .prepare("SELECT stage FROM wa_payment_sessions WHERE account_id=?")
    .get(account) as { stage: string } | undefined;
  if (started?.stage !== "address") return start;
  if (!recipient) {
    db.prepare(
      "INSERT INTO wa_payment_language_entries(account_id,amount,expires) VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET amount=excluded.amount,expires=excluded.expires",
    ).run(account, amount!, Date.now() + 600000);
    return text(
      `Prepare ${amount} Demo USD (test token). Who should receive it? Enter a saved name, full international phone number or full 0x address. Type Cancel to stop.`,
    );
  }
  // Names that happen to be menu commands must not execute another action.
  if (
    actionFor(recipient) ||
    /^(?:menu|cancel|send|help|settings|activity)$/i.test(recipient) ||
    recipient.includes(":")
  )
    return text(
      "Please enter the recipient’s full 0x address or choose Saved contact. Nothing was sent.",
    );
  const resolved = paymentReply(db, key, { ...message, input: recipient });
  const selected = db
    .prepare("SELECT stage FROM wa_payment_sessions WHERE account_id=?")
    .get(account) as { stage: string } | undefined;
  if (selected?.stage !== "amount") {
    if (amount)
      db.prepare(
        "INSERT INTO wa_payment_language_entries(account_id,amount,expires) VALUES(?,?,?) ON CONFLICT(account_id) DO UPDATE SET amount=excluded.amount,expires=excluded.expires",
      ).run(account, amount, Date.now() + 600000);
    return resolved;
  }
  return amount ? paymentReply(db, key, { ...message, input: amount }) : resolved;
}
