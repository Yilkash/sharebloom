// Anonymous user funnel: counts only. Never prints a phone number, address, name or message.
// Opens the WhatsApp database read-only and reads public balances on BNB Chain.
// Run inside the Railway service, where the database lives:
//   railway ssh            then   node scripts/funnel.mjs
// Accounts listed in FUNNEL_EXCLUDE_WALLETS (comma-separated addresses, e.g. the team's own
// test wallets) are left out of every count.
import { DatabaseSync } from "node:sqlite";

const DB = process.env.WHATSAPP_DATABASE_PATH || ".data/whatsapp.sqlite";
const RPC = "https://bsc-dataseed.bnbchain.org";
const USDT = "0x55d398326f99059ff775485246999027b3197955";
const DAY = 86_400_000;
const exclude = new Set(
  (process.env.FUNNEL_EXCLUDE_WALLETS || "0xe8a292b0DE557b97423d1B853eb0F6da26bAC2f2")
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean),
);

const db = new DatabaseSync(DB, { readOnly: true });
const all = (sql, ...args) => db.prepare(sql).all(...args);
const has = (table) =>
  Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));

const wallets = has("wa_mainnet_wallets") ? all("SELECT account_id, address FROM wa_mainnet_wallets") : [];
const skip = new Set(wallets.filter((w) => exclude.has(w.address.toLowerCase())).map((w) => w.account_id));
const keep = (rows) => rows.filter((r) => !skip.has(r.account_id ?? r.id));

const accounts = keep(all("SELECT id, created FROM wa_accounts WHERE status='active'"));
const ids = new Set(accounts.map((a) => a.id));
const userWallets = wallets.filter((w) => ids.has(w.account_id));

// Public on-chain facts per wallet, reduced to yes/no before anything is counted.
async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  return (await r.json()).result;
}
let funded = 0,
  holdsUsdt = 0,
  usedWallet = 0,
  unreadable = 0;
for (const w of userWallets) {
  try {
    const data = "0x70a08231" + w.address.slice(2).toLowerCase().padStart(64, "0");
    const [usdt, bnb, nonce] = await Promise.all([
      rpc("eth_call", [{ to: USDT, data }, "latest"]),
      rpc("eth_getBalance", [w.address, "latest"]),
      rpc("eth_getTransactionCount", [w.address, "latest"]),
    ]);
    const hasUsdt = BigInt(usdt || "0x0") > 0n;
    const sent = Number(BigInt(nonce || "0x0")) > 0;
    if (hasUsdt) holdsUsdt++;
    if (sent) usedWallet++;
    if (hasUsdt || sent || BigInt(bnb || "0x0") > 0n) funded++;
  } catch {
    unreadable++;
  }
}

const orders = has("wa_mainnet_orders")
  ? keep(all("SELECT account_id, state, error, created FROM wa_mainnet_orders"))
  : [];
const traders = new Set(orders.filter((o) => o.state === "confirmed").map((o) => o.account_id));
const reviewers = new Set(orders.map((o) => o.account_id));
const gifts = has("wa_gas_topups") ? keep(all("SELECT account_id, state FROM wa_gas_topups")) : [];
const askers = has("wa_assistant_requests")
  ? new Set(keep(all("SELECT account_id FROM wa_assistant_requests")).map((r) => r.account_id))
  : new Set();
const countBy = (rows, key) =>
  Object.entries(rows.reduce((m, r) => ((m[r[key] ?? "none"] = (m[r[key] ?? "none"] || 0) + 1), m), {}))
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}: ${n}`)
    .join(", ") || "none";
const since = (ms) => accounts.filter((a) => a.created > Date.now() - ms).length;

console.log(`Sharebloom funnel (excluding ${skip.size} team wallet${skip.size === 1 ? "" : "s"})`);
console.log("");
console.log(`Accounts created            ${accounts.length}   (last 24h: ${since(DAY)}, last 7 days: ${since(7 * DAY)})`);
console.log(`  with a wallet             ${userWallets.length}`);
console.log(`  talked to the AI          ${[...askers].filter((a) => ids.has(a)).length}`);
console.log(`  deposited anything        ${funded}${unreadable ? `   (${unreadable} wallet(s) could not be read)` : ""}`);
console.log(`  hold USDT now             ${holdsUsdt}`);
console.log(`  got the BNB gas gift      ${gifts.filter((g) => g.state === "confirmed").length}   (all gift rows: ${countBy(gifts, "state")})`);
console.log(`  opened a trade review     ${reviewers.size}`);
console.log(`  completed a trade         ${traders.size}`);
console.log(`  sent a transaction        ${usedWallet}`);
console.log("");
console.log(`Trade reviews by outcome    ${countBy(orders, "state")}`);
console.log(`Stopped trades by reason    ${countBy(orders.filter((o) => o.error), "error")}`);
db.close();
