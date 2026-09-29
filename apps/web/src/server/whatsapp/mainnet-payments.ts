import type { DatabaseSync } from "node:sqlite";
import { getAddress, isAddress, zeroAddress } from "viem";
import { seal, unseal, senderLookup } from "./config";
import { text } from "./menu";
import { contactByName } from "./contacts";
import { normalizePhone } from "./phone-recipients";
import { mainnetTradeReviewReply, mainnetTradeStatusReply } from "../stocks/mainnet-orders";
import { ensureMainnetWallet } from "../stocks/mainnet-wallet";
import { mainnetReceiveReply, mainnetPortfolioReply } from "./mainnet-stocks";
import { MAINNET_QUOTE } from "../networks/chain";

type Draft = { recipient?: string; amount?: string };
export function migrateMainnetPayments(db: DatabaseSync) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS wa_mainnet_payment_drafts(account_id TEXT PRIMARY KEY,payload TEXT NOT NULL,expires INTEGER NOT NULL)",
  );
}
export function mainnetPaymentEntry(
  db: DatabaseSync,
  key: Buffer,
  account: string,
  input: string,
  start = false,
) {
  const row = db
    .prepare("SELECT payload FROM wa_mainnet_payment_drafts WHERE account_id=? AND expires>?")
    .get(account, Date.now()) as { payload: string } | undefined;
  if (!start && !row) return null;
  if (/^(?:cancel|menu)$/i.test(input)) {
    db.prepare("DELETE FROM wa_mainnet_payment_drafts WHERE account_id=?").run(account);
    return null;
  }
  const draft: Draft = start ? {} : unseal<Draft>(row!.payload, key);
  if (!start) {
    if (!draft.recipient) draft.recipient = input.trim();
    else draft.amount = input.trim().replace(/\s*USDG$/i, "");
  }
  if (draft.amount && !/^(?:0|[1-9]\d{0,3})(?:\.\d{1,6})?$/.test(draft.amount))
    return text("Enter a USDG amount, for example 0.5. Type Cancel to stop.");
  db.prepare(
    "INSERT OR REPLACE INTO wa_mainnet_payment_drafts(account_id,payload,expires) VALUES(?,?,?)",
  ).run(account, seal(draft, key), Date.now() + 600000);
  if (!draft.recipient)
    return text(
      "Who should receive USDG on Robinhood mainnet? Enter a wallet address, saved contact name or full international phone number.",
    );
  if (!draft.amount) return text("How much USDG would you like to send?");
  return {
    _steward_type: "mainnet_action",
    action: "send",
    recipient: draft.recipient,
    amount: draft.amount,
  };
}
export async function mainnetPaymentReview(
  db: DatabaseSync,
  key: Buffer,
  account: string,
  phone: string,
  messageId: string,
  recipient: string,
  amount: string,
) {
  let address: string | undefined;
  if (isAddress(recipient)) address = recipient;
  else {
    const contact = contactByName(db, key, account, recipient);
    if (contact) address = contact.address;
    else {
      const normalized = normalizePhone(recipient);
      if (normalized) {
        const n = db
          .prepare(
            "SELECT count(*) n FROM wa_phone_lookup_attempts WHERE account_id=? AND created>?",
          )
          .get(account, Date.now() - 3600000) as { n: number };
        if (n.n >= 20)
          return text(
            "Phone lookup is temporarily limited. Use a wallet address or saved contact.",
          );
        db.prepare("INSERT INTO wa_phone_lookup_attempts(account_id,created) VALUES(?,?)").run(
          account,
          Date.now(),
        );
        const found = db
          .prepare(
            "SELECT w.address FROM wa_accounts a JOIN wa_mainnet_wallets w ON w.account_id=a.id WHERE a.sender=? AND a.status='active' AND a.phone_lookup=1",
          )
          .get(senderLookup(normalized, key)) as { address: string } | undefined;
        address = found?.address;
      }
    }
  }
  if (
    !address ||
    !isAddress(address) ||
    [zeroAddress, MAINNET_QUOTE.address].some((a) => a.toLowerCase() === address!.toLowerCase())
  ) {
    db.prepare("DELETE FROM wa_mainnet_payment_drafts WHERE account_id=?").run(account);
    return text(
      "I couldn’t resolve that mainnet recipient. Use their full wallet address. Phone lookup requires their permission and a mainnet wallet.",
    );
  }
  try {
    await ensureMainnetWallet(db, account);
  } catch {
    return text("Your mainnet wallet setup is unavailable. Nothing sent.");
  }
  const result = await mainnetTradeReviewReply(
    db,
    key,
    account,
    phone,
    messageId,
    "AAPL",
    "buy",
    amount,
    getAddress(address),
  );
  db.prepare("DELETE FROM wa_mainnet_payment_drafts WHERE account_id=?").run(account);
  return result;
}
export async function mainnetAction(
  db: DatabaseSync,
  key: Buffer,
  phone: string,
  messageId: string,
  action: string,
  recipient?: string,
  amount?: string,
) {
  const account = db
    .prepare("SELECT id FROM wa_accounts WHERE sender=? AND status='active'")
    .get(senderLookup(phone, key)) as { id: string } | undefined;
  if (!account) return text("Create your Steward account first.");
  if (action === "receive") return mainnetReceiveReply(db, account.id);
  if (action === "balance") return mainnetPortfolioReply(db, account.id);
  if (action === "history") return mainnetTradeStatusReply(db, account.id);
  if (action === "send" && recipient && amount)
    return mainnetPaymentReview(db, key, account.id, phone, messageId, recipient, amount);
  return text("Choose Send payment to prepare a USDG transfer.");
}
