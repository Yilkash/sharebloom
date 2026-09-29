import { mainnetTradeReviewText, mainnetTradeDetailsText } from "./mainnet-review";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { formatEther, formatUnits, getAddress } from "viem";
import { seal, unseal, senderLookup } from "../whatsapp/config";
import { text } from "../whatsapp/menu";
import {
  mainnetTradeConfig,
  prepareMainnetPlan,
  prepareMainnetTransfer,
  validateMainnetPlan,
  type MainnetPlan,
} from "./mainnet-trade";
import { MAINNET_EXECUTION_READY, type MainnetStock } from "../networks/chain";
export const orderDigest = (s: string) => createHash("sha256").update(s).digest("hex");
export type MainnetWallet = {
  account_id: string;
  address: string;
  provider_id: string;
  external_id: string;
  app_id: string;
  owner_id: string;
  policy_id: string;
};
export type MainnetReview = { plan: MainnetPlan; wallet: MainnetWallet };
export type MainnetOrder = {
  id: string;
  account_id: string;
  sender: string;
  recipient: string;
  source_message: string;
  payload: string;
  state: string;
  expires: number;
  created: number;
  confirmation_hash: string | null;
  confirmed_at: number | null;
  reply_until: number;
  lease: string | null;
  lease_until: number | null;
};
export function migrateMainnetOrders(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS wa_mainnet_wallets(account_id TEXT PRIMARY KEY,address TEXT NOT NULL UNIQUE,provider_id TEXT NOT NULL UNIQUE,external_id TEXT NOT NULL UNIQUE,app_id TEXT NOT NULL,owner_id TEXT NOT NULL,policy_id TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS wa_mainnet_orders(id TEXT PRIMARY KEY,account_id TEXT NOT NULL,sender TEXT NOT NULL,recipient TEXT NOT NULL,source_message TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,confirmation_hash TEXT,confirmed_at INTEGER,confirmation_message TEXT,reply_until INTEGER NOT NULL,lease TEXT,lease_until INTEGER,next_check INTEGER NOT NULL DEFAULT 0,error TEXT,UNIQUE(account_id,source_message));
  CREATE UNIQUE INDEX IF NOT EXISTS wa_mainnet_one_active ON wa_mainnet_orders(account_id) WHERE state IN ('review','queued','running','unknown');
  CREATE TABLE IF NOT EXISTS wa_mainnet_steps(order_id TEXT NOT NULL,position INTEGER NOT NULL,state TEXT NOT NULL,reference_id TEXT NOT NULL UNIQUE,idempotency_key TEXT NOT NULL UNIQUE,nonce INTEGER,tx_hash TEXT,PRIMARY KEY(order_id,position));`);
}
export function mainnetWallet(db: DatabaseSync, account: string) {
  return db
    .prepare(
      "SELECT w.* FROM wa_mainnet_wallets w JOIN wa_accounts a ON a.id=w.account_id WHERE w.account_id=? AND a.status='active'",
    )
    .get(account) as MainnetWallet | undefined;
}
export function walletStillMatches(db: DatabaseSync, review: MainnetReview) {
  const wallet = mainnetWallet(db, review.wallet.account_id);
  return (
    wallet &&
    Object.keys(review.wallet).every(
      (k) => wallet[k as keyof MainnetWallet] === review.wallet[k as keyof MainnetWallet],
    ) &&
    wallet.policy_id === mainnetTradeConfig().policy &&
    wallet.app_id === process.env.PRIVY_APP_ID &&
    wallet.owner_id === process.env.PRIVY_WALLET_OWNER_ID
  );
}
export async function mainnetTradeReviewReply(
  db: DatabaseSync,
  key: Buffer,
  account: string,
  phone: string,
  messageId: string,
  symbol: MainnetStock,
  side: "buy" | "sell",
  amount: string,
  transferTo?: `0x${string}`,
) {
  if (!MAINNET_EXECUTION_READY || process.env.MAINNET_STOCK_TRADING_ENABLED !== "true")
    return text("Mainnet trading setup is still pending. You can request a price preview now.");
  const wallet = mainnetWallet(db, account);
  if (!wallet)
    return text(
      "Your mainnet trading wallet isn’t set up yet. Your test payment wallet is separate.",
    );
  try {
    const plan = transferTo
      ? await prepareMainnetTransfer(getAddress(wallet.address), transferTo, amount)
      : await prepareMainnetPlan(getAddress(wallet.address), symbol, side, amount);
    const review = { plan, wallet };
    if (!walletStillMatches(db, review)) throw Error("wallet_changed");
    const now = Date.now(),
      token = randomBytes(24).toString("hex");
    db.exec("SAVEPOINT mainnet_review");
    try {
      db.prepare(
        "UPDATE wa_mainnet_orders SET state='expired',confirmation_hash=NULL WHERE account_id=? AND state='review' AND expires<=?",
      ).run(account, now);
      if (
        db
          .prepare(
            "SELECT id FROM wa_mainnet_orders WHERE account_id=? AND (source_message=? OR state IN ('review','queued','running','unknown'))",
          )
          .get(account, messageId)
      ) {
        db.exec("RELEASE mainnet_review");
        return text(
          "You already have a payment or trade awaiting completion. Use its buttons or ask for recent activity.",
        );
      }
      db.prepare(
        "INSERT INTO wa_mainnet_orders(id,account_id,sender,recipient,source_message,payload,state,created,expires,confirmation_hash,reply_until) VALUES(?,?,?,?,?,?,'review',?,?,?,?)",
      ).run(
        plan.id,
        account,
        senderLookup(phone, key),
        seal({ to: phone }, key),
        messageId,
        seal(review, key),
        now,
        plan.deadline * 1000,
        orderDigest(token),
        now + 23 * 3600000,
      );
      plan.steps.forEach((_, i) =>
        db
          .prepare(
            "INSERT INTO wa_mainnet_steps(order_id,position,state,reference_id,idempotency_key) VALUES(?,?,'pending',?,?)",
          )
          .run(plan.id, i, `mainnet:${plan.id}:${i}`, randomUUID()),
      );
      db.exec("RELEASE mainnet_review");
    } catch (e) {
      db.exec("ROLLBACK TO mainnet_review");
      db.exec("RELEASE mainnet_review");
      throw e;
    }
    const fee = plan.steps.reduce(
      (sum, step) => sum + BigInt(step.gas) * BigInt(step.gasPrice),
      0n,
    );
    return {
      type: "interactive",
      interactive: {
        type: "button",
        body: {
          text: transferTo
            ? `Review payment · Robinhood mainnet\n\nSend: ${formatUnits(BigInt(plan.amountIn), 6)} USDG\nTo: ${transferTo}\nEstimated network fee: ${formatEther(BigInt(plan.estimatedFee!))} ETH\nMaximum network fee: ${formatEther(fee)} ETH\nExpires: ${new Date(plan.deadline * 1000).toISOString().slice(11, 19)} UTC\n\nConfirm sends real USDG to this address.`
            : mainnetTradeReviewText(plan),
        },
        action: {
          buttons: [
            {
              type: "reply",
              reply: {
                id: `mainstock:confirm:${plan.id}:${token}`,
                title: transferTo
                  ? "Confirm payment"
                  : side === "buy"
                    ? "Confirm buy"
                    : "Confirm sell",
              },
            },
            {
              type: "reply",
              reply: { id: `mainstock:cancel:${plan.id}:${token}`, title: "Cancel" },
            },
            ...(!transferTo
              ? [
                  {
                    type: "reply",
                    reply: { id: `mainstock:details:${plan.id}:${token}`, title: "Details" },
                  },
                ]
              : []),
          ],
        },
      },
    };
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const reasons: Record<string, string> = {
      insufficient_tokens: "Your wallet doesn’t have enough of the input token.",
      insufficient_eth_for_network_fee: "Your wallet needs more ETH for the reviewed network fee.",
      route_unavailable: "The quote service is temporarily unavailable.",
      lifi_quote_unavailable: "Both trading quote services are temporarily unavailable.",
      lifi_fee_limit_exceeded: "The backup provider’s fee exceeds the allowed limit.",
      route_busy: "The trading quote service is busy right now.",
      route_build_unavailable: "The quote service couldn’t prepare this trade.",
      route_expired: "The provider returned an expired quote.",
      registry_unavailable: "Robinhood’s token registry is temporarily unavailable.",
      invalid_amount: "Please provide a valid spending amount.",
    };
    console.warn(
      "Mainnet preparation failed:",
      code in reasons ? code : "provider_or_validation_unavailable",
    );
    return text(
      (reasons[code] ?? "I couldn’t complete the network checks for this review.") +
        " Nothing was sent. Please try again shortly.",
    );
  }
}
export function mainnetConfirmationReply(
  db: DatabaseSync,
  key: Buffer,
  account: string,
  input: string,
  messageId: string,
) {
  const match = /^mainstock:(confirm|cancel|details):([a-f0-9-]{36}):([a-f0-9]{48})$/.exec(input);
  const row = match
    ? (db
        .prepare("SELECT * FROM wa_mainnet_orders WHERE account_id=? AND id=?")
        .get(account, match[2]) as MainnetOrder | undefined)
    : undefined;
  if (
    !match ||
    !row ||
    !row.confirmation_hash ||
    row.confirmation_hash.length !== 64 ||
    !timingSafeEqual(Buffer.from(row.confirmation_hash), Buffer.from(orderDigest(match[3])))
  )
    return text("That trade button expired or was used. Ask for stock trade status.");
  if (row.state !== "review")
    return text("That review was already handled. No duplicate trade was sent.");
  if (row.expires <= Date.now() || match[1] === "cancel") {
    db.prepare(
      "UPDATE wa_mainnet_orders SET state=?,confirmation_hash=NULL WHERE id=? AND state='review'",
    ).run(match[1] === "cancel" ? "cancelled" : "expired", row.id);
    return text(
      match[1] === "cancel" ? "Cancelled. Nothing sent." : "Quote expired. Request a new review.",
    );
  }
  if (!MAINNET_EXECUTION_READY || process.env.MAINNET_STOCK_TRADING_ENABLED !== "true")
    return text("Mainnet transactions are currently disabled. Nothing sent.");
  try {
    const review = unseal<MainnetReview>(row.payload, key);
    validateMainnetPlan(review.plan);
    if (!walletStillMatches(db, review)) throw Error("wallet_changed");
    if (match[1] === "details") {
      if (review.plan.side === "send") return text("Use the original payment review.");
      return text(mainnetTradeDetailsText(review.plan));
    }
    const result = db
      .prepare(
        "UPDATE wa_mainnet_orders SET state='queued',confirmed_at=?,confirmation_message=?,confirmation_hash=NULL WHERE id=? AND state='review' AND expires>?",
      )
      .run(Date.now(), messageId, row.id, Date.now());
    return text(
      result.changes === 1
        ? "Confirmed. I’ll send the receipt here. Please don’t submit it again."
        : "Quote expired. Request a new review.",
    );
  } catch {
    return text("Your trading setup changed. Request a new review. Nothing sent.");
  }
}
export function mainnetTradeStatusReply(db: DatabaseSync, account: string) {
  const orders = db
    .prepare(
      "SELECT id,state,created FROM wa_mainnet_orders WHERE account_id=? ORDER BY created DESC LIMIT 3",
    )
    .all(account) as { id: string; state: string; created: number }[];
  if (!orders.length) return text("No mainnet payments or trades yet.");
  return text(
    "Recent mainnet activity\n\n" +
      orders
        .map((o) => {
          const steps = db
            .prepare(
              "SELECT tx_hash FROM wa_mainnet_steps WHERE order_id=? AND tx_hash IS NOT NULL ORDER BY position",
            )
            .all(o.id) as { tx_hash: string }[];
          const label: Record<string, string> = {
            review: "Awaiting your confirmation",
            queued: "Confirmed; waiting to submit",
            running: "Processing",
            unknown: "Checking network outcome—don’t resubmit",
            confirmed: "Complete",
            failed: steps.length
              ? "Stopped—check receipts and remaining approval"
              : "Stopped before submission; no gas spent",
            expired: "Review expired",
            cancelled: "Cancelled",
          };
          return `${new Date(o.created).toISOString().slice(11, 19)} UTC: ${label[o.state] ?? "Checking"}${steps.length ? "\n" + steps.map((s) => `https://robinhoodchain.blockscout.com/tx/${s.tx_hash}`).join("\n") : ""}`;
        })
        .join("\n\n"),
  );
}
