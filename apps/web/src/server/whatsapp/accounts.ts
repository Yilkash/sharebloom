import { migrateMainnetPayments, mainnetPaymentEntry } from "./mainnet-payments";
import { migrateMainnetOrders, mainnetConfirmationReply } from "../stocks/mainnet-orders";
import { migrateStockOrders, stockConfirmationReply } from "../stocks/orders";
import { migrateStockQuotes } from "../stocks/quote-store";
import { migratePaymentLanguage, paymentLanguageReply } from "./payment-language";
import { migrateAssistant, assistantRoute, assistantSession } from "./assistant";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { migratePhoneRecipients, phoneSettings } from "./phone-recipients";
import { migrateContacts, contactsReply } from "./contacts";
import { migratePayments, paymentReply } from "./payments";
import { senderLookup } from "./config";
import { actionFor, menu, text, onboardingWelcome } from "./menu";
import { migrateWalletSetup, walletSetupReply, walletAddress, readyAccount } from "./wallet-setup";

// Version the exact disclosure so later custody changes require fresh consent.
export const CONSENT_VERSION = "sharebloom-account-v1";
export const DISCLOSURE =
  "Create a Sharebloom account\n\nSharebloom controls your wallet and authorizes only transactions you confirm. Stock trades and USDT payments on BNB Chain use real assets. Control of this WhatsApp account gives access to your Sharebloom account.\n\nContinuing creates your account and requests a dedicated BNB Chain wallet. No funds are added. Phone-number recipient lookup is off until you choose to enable it.\n\nThis choice expires in 10 minutes.";
type Account = { id: string; status: string; wallet_state: string };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export function migrateAccounts(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wa_accounts (
      id TEXT PRIMARY KEY, sender TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'active',
      consent_version TEXT NOT NULL, consent_at INTEGER NOT NULL, consent_message_id TEXT NOT NULL,
      phone_lookup INTEGER NOT NULL DEFAULT 0, wallet_state TEXT NOT NULL DEFAULT 'awaiting_provider',
      created INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS wa_account_consents (
      token_hash TEXT PRIMARY KEY, sender TEXT NOT NULL, version TEXT NOT NULL,
      expires INTEGER NOT NULL, consumed INTEGER, outcome TEXT
    );
    CREATE TABLE IF NOT EXISTS wa_wallet_requests (
      account_id TEXT PRIMARY KEY REFERENCES wa_accounts(id), external_id TEXT NOT NULL UNIQUE,
      idempotency_key TEXT NOT NULL UNIQUE, chain INTEGER NOT NULL CHECK(chain=46630),
      state TEXT NOT NULL DEFAULT 'awaiting_provider', created INTEGER NOT NULL
    );
  `);
  migrateWalletSetup(db);
  migratePayments(db);
  migrateContacts(db);
  migratePhoneRecipients(db);
  migrateAssistant(db);
  migratePaymentLanguage(db);
  migrateStockQuotes(db);
  migrateStockOrders(db);
  migrateMainnetOrders(db);
  migrateMainnetPayments(db);
}
// Invoked inside the inbox/outbox transaction; account creation, consuming consent and
// enqueueing its reply succeed together. No provider/network work belongs in this function.
export function accountReply(
  db: DatabaseSync,
  key: Buffer,
  message: { from: string; input: string; id: string; timestamp?: number },
) {
  const sender = senderLookup(message.from, key);
  const command = message.input.trim().toLowerCase().replace(/^\//, "");
  const account = db
    .prepare("SELECT id,status,wallet_state FROM wa_accounts WHERE sender=?")
    .get(sender) as Account | undefined;
  if (account && account.status !== "active")
    return text(
      "This account is paused. Contact the Sharebloom operator for recovery. No wallet action was performed.",
    );
  const mainnetDraft =
    account &&
    db
      .prepare("SELECT account_id FROM wa_mainnet_payment_drafts WHERE account_id=? AND expires>?")
      .get(account.id, Date.now());
  const shortcut =
    (mainnetDraft || (account && assistantSession(db, account.id))) && /^\d+$/.test(command)
      ? undefined
      : actionFor(command);
  if (account && !shortcut && !message.input.includes(":")) {
    const draft = mainnetPaymentEntry(db, key, account.id, message.input);
    if (draft && !["menu", "cancel"].includes(command)) return draft;
  }
  if (
    account &&
    shortcut &&
    ["send", "receive", "balance", "history"].includes(shortcut) &&
    !(assistantSession(db, account.id) && /^\d+$/.test(command))
  ) {
    assistantRoute(db, account.id, "Menu", message.id);
    db.prepare("DELETE FROM wa_payment_sessions WHERE account_id=?").run(account.id);
    db.prepare("DELETE FROM wa_payment_language_entries WHERE account_id=?").run(account.id);
    db.prepare("DELETE FROM wa_mainnet_payment_drafts WHERE account_id=?").run(account.id);
    if (shortcut === "send") return mainnetPaymentEntry(db, key, account.id, message.input, true);
    return { _steward_type: "mainnet_action", action: shortcut };
  }
  if (account && shortcut === "create")
    return { _steward_type: "mainnet_action", action: "receive" };
  // Confirmation payloads must never pass through natural-language parsing.
  if (message.input.startsWith("mainstock:"))
    return account
      ? mainnetConfirmationReply(db, key, account.id, message.input, message.id)
      : text("Create your account first.");
  if (message.input.startsWith("stock:"))
    return account
      ? stockConfirmationReply(db, key, account.id, message.input, message.id)
      : text("Create your Sharebloom account first. Nothing was submitted.");
  if (message.input.startsWith("pay:"))
    return paymentReply(db, key, message) ?? text("Create your wallet first. Type Menu to begin.");
  if (["recent", "recent activity", "activity", "history"].includes(command))
    return (
      paymentReply(db, key, { ...message, input: "Recent activity" }) ??
      text("Create your wallet first to view payment activity.")
    );
  const inChat = account && assistantSession(db, account.id);
  const paymentEntry =
    account &&
    db.prepare("SELECT account_id FROM wa_payment_sessions WHERE account_id=?").get(account.id);
  if (account && ["menu", "cancel"].includes(command))
    assistantRoute(db, account.id, message.input, message.id);
  if (
    message.input.startsWith("servchat:") ||
    (actionFor(command) === "chat" && !((paymentEntry || inChat) && /^\d+$/.test(command)))
  ) {
    return account
      ? assistantRoute(db, account.id, message.input, message.id)
      : text("Create your Sharebloom account first, then choose Ask Sharebloom from Menu.");
  }
  if (
    message.input.startsWith("phoneprivacy:") ||
    ["settings", "help"].includes(command) ||
    (actionFor(command) === "help" && !((paymentEntry || inChat) && /^\d+$/.test(command)))
  ) {
    if (account) {
      assistantRoute(db, account.id, "Menu", message.id);
      db.prepare("DELETE FROM wa_contact_sessions WHERE account_id=?").run(account.id);
      db.prepare("DELETE FROM wa_payment_sessions WHERE account_id=?").run(account.id);
      db.prepare("DELETE FROM wa_payment_recipient_labels WHERE account_id=?").run(account.id);
    }
    return account
      ? phoneSettings(db, account.id, message.input, message.id)
      : text(
          "Create your Sharebloom account first to use phone-number settings. Type Menu to begin.",
        );
  }
  // Ordinary chat language reaches intent inference first. Button payloads keep
  // their deterministic handlers and cannot authorize actions through the model.
  if (
    account &&
    ((command.startsWith("menu:") && command !== "menu:chat") ||
      /^contact:(?:add|edit|pick|page)(?::|$)/.test(command))
  )
    assistantRoute(db, account.id, "Menu", message.id);
  if (
    account &&
    assistantSession(db, account.id) &&
    !/^(?:menu|pay|contact|paycontact|phoneprivacy|walletsetup|enroll|servchat):/.test(
      message.input,
    ) &&
    !["menu", "cancel", "hi", "hello", "start"].includes(command)
  ) {
    const intent = assistantRoute(db, account.id, message.input, message.id);
    if (intent) return intent;
  }
  const contact = account && contactsReply(db, key, account.id, message.input);
  if (contact) return contact;
  const naturalPayment =
    account &&
    /\b(?:testnet|demo\s*usd|dusd|46630)\b/i.test(message.input) &&
    paymentLanguageReply(db, key, account.id, message);
  if (naturalPayment) return naturalPayment;
  const payment =
    /^(?:pay|paycontact):/.test(message.input) ||
    /\b(?:testnet|demo\s*usd|dusd|46630)\b/i.test(message.input)
      ? paymentReply(db, key, message)
      : null;
  if (payment) return payment;
  if (message.input.startsWith("walletsetup:")) {
    return account
      ? walletSetupReply(db, sender, account.id, message.input, message.id)
      : text("Create a Sharebloom test account first. Type Menu to begin.");
  }
  if (message.input.startsWith("enroll:")) {
    const match = /^enroll:(accept|cancel):([a-f0-9]{48})$/.exec(message.input);
    if (!match)
      return text(
        "This account confirmation is invalid. Choose Create account from Menu for a new one.",
      );
    const [, action, token] = match;
    const consent = db
      .prepare(
        "SELECT token_hash FROM wa_account_consents WHERE token_hash=? AND sender=? AND version=? AND consumed IS NULL AND expires>?",
      )
      .get(digest(token), sender, CONSENT_VERSION, Date.now());
    if (!consent)
      return text(
        "This confirmation expired or was already used. Type Menu to view your account or start again.",
      );
    db.prepare(
      "UPDATE wa_account_consents SET consumed=?,outcome=? WHERE token_hash=? AND consumed IS NULL",
    ).run(Date.now(), action, digest(token));
    if (action === "cancel")
      return text("Account setup cancelled. No wallet was created. Type Menu to return.");
    let accountId = account?.id;
    if (!account) {
      const id = randomUUID(),
        now = Date.now();
      accountId = id;
      db.prepare(
        "INSERT INTO wa_accounts(id,sender,consent_version,consent_at,consent_message_id,created) VALUES(?,?,?,?,?,?)",
      ).run(id, sender, CONSENT_VERSION, now, message.id, now);
      db.prepare(
        "INSERT INTO wa_wallet_requests(account_id,external_id,idempotency_key,chain,created) VALUES(?,?,?,?,?)",
      ).run(id, "steward_" + id, randomUUID(), 46630, now);
    }
    // The accepted account disclosure covers the dedicated mainnet wallet.
    return { _steward_type: "mainnet_action", action: "receive" };
  }
  const action = actionFor(command);
  if (
    action === "create" ||
    ["my account", "menu:account", "account", "can i see the account"].includes(command)
  ) {
    if (account) return { _steward_type: "mainnet_action", action: "receive" };
    // Invalidate older offers so only the newest account consent can be used.
    db.prepare(
      "UPDATE wa_account_consents SET consumed=?,outcome='superseded' WHERE sender=? AND consumed IS NULL",
    ).run(Date.now(), sender);
    const token = randomBytes(24).toString("hex");
    db.prepare(
      "INSERT INTO wa_account_consents(token_hash,sender,version,expires) VALUES(?,?,?,?)",
    ).run(digest(token), sender, CONSENT_VERSION, Date.now() + 10 * 60_000);
    return {
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: DISCLOSURE },
        action: {
          buttons: [
            {
              type: "reply",
              reply: { id: "enroll:accept:" + token, title: "Create account" },
            },
            { type: "reply", reply: { id: "enroll:cancel:" + token, title: "Cancel" } },
          ],
        },
      },
    };
  }
  if (command === "menu") return menu(!!account);
  if (["hi", "hello", "start"].includes(command)) {
    if (!account) return onboardingWelcome();

    return assistantRoute(db, account.id, "Ask Sharebloom", message.id);
  }
  if (action && ["balance", "send", "receive", "history", "contacts"].includes(action)) {
    const wallet = account && walletAddress(db, account.id);
    if (wallet && action === "balance") return { _steward_type: "balance" };
    if (wallet)
      return action === "receive"
        ? readyAccount(wallet.address)
        : text(
            "Your test wallet is ready. This feature is still being connected; no payment was prepared or sent. Choose My account or Receive payment to see your address. Type Menu to return.",
          );
    return text(
      account
        ? "Your test account is ready, but wallet setup is pending. This action is not available yet; no payment was prepared or sent. Type Menu to return."
        : "Create your Sharebloom test account first: type Create account to review the details. Wallet setup is still pending.",
    );
  }
  const chat = account && assistantRoute(db, account.id, message.input, message.id);
  if (chat) return chat;
  if (account && !action) {
    // Start the session, then handle the actual message instead of discarding it.
    const started = assistantRoute(db, account.id, "Ask Sharebloom", message.id);
    if (!assistantSession(db, account.id)) return started;
    return assistantRoute(db, account.id, message.input, message.id) ?? started;
  }
  if (!account && !action) return onboardingWelcome();
  return action || command === "help" ? null : menu(!!account);
}
