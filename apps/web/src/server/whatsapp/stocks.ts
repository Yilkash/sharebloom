import type { DatabaseSync } from "node:sqlite";
import { formatUnits, getAddress } from "viem";
import { STOCKS, stockPortfolio, stockQuote, type StockSymbol } from "../stocks/market";
import { readStockQuote, saveStockQuote } from "../stocks/quote-store";
import { text } from "./menu";

export function stockListReply() {
  return text(
    "Test stock previews on Robinhood Chain testnet\n\n" +
      Object.entries(STOCKS)
        .map(([symbol, asset]) => `${symbol} — ${asset.name}`)
        .join("\n") +
      "\n\nAsk ‘Show my stock portfolio’ or ‘Quote buying Tesla with 2 USDT’. Sell estimates use the number of stock tokens.\n\nQuotes use test USDT, separate from Demo USD. Buying and selling are not enabled yet. Test assets have no monetary value.",
  );
}
export async function stockPortfolioReply(db: DatabaseSync, account: string) {
  const readAccount = () =>
    db
      .prepare(
        "SELECT a.status,w.address,w.chain FROM wa_accounts a LEFT JOIN wa_managed_wallets w ON w.account_id=a.id WHERE a.id=?",
      )
      .get(account) as { status: string; address: string | null; chain: number | null } | undefined;
  const owner = readAccount();
  if (!owner || owner.status !== "active")
    return text("An active Sharebloom account is needed to view its stock portfolio.");
  if (!owner.address || owner.chain !== 46630)
    return text("Your Sharebloom testnet wallet is not ready. Choose My account to check setup.");
  try {
    const result = await stockPortfolio(getAddress(owner.address));
    const current = readAccount();
    if (current?.status !== "active" || current.address !== owner.address)
      return text("Your account changed. Please request the portfolio again.");
    return text(
      `Your Sharebloom testnet portfolio\n\n${result.balances.map((t) => `${t.symbol}: ${formatUnits(t.balance, t.decimals)}`).join("\n")}\n\nWallet: ${owner.address}\nChecked at ${new Date(Number(result.block.timestamp) * 1000).toISOString()}\n\nThis is your Sharebloom wallet. Tokens in a separate MetaMask wallet are not included. Test assets have no monetary value. Trading is not enabled yet.`,
    );
  } catch {
    return text(
      "I couldn’t read your stock portfolio right now. Please try again. No trade was submitted.",
    );
  }
}
export async function stockQuoteReply(
  db: DatabaseSync,
  key: Buffer,
  account: string,
  messageId: string,
  symbol: StockSymbol,
  side: "buy" | "sell",
  amount: string,
) {
  const existing = readStockQuote(db, key, account, messageId);
  if (existing)
    return text(
      existing.expires > Date.now()
        ? existing.body
        : "That stock estimate has expired. Send a new quote request for current pool data. Nothing was submitted.",
    );
  try {
    const q = await stockQuote(symbol, side, amount);
    const body = `Testnet ${side} estimate — ${symbol}\n\nInput: ${formatUnits(q.amountIn, q.decimalsIn)} ${side === "buy" ? "USDT" : symbol}\nEstimated output: ${formatUnits(q.amountOut, q.decimalsOut)} ${side === "buy" ? symbol : "USDT"}\nPool fee: 0.3% (included)\nNetwork gas: not included\nSource: HoodSwap testnet pool, block ${q.block.number}\nChecked at ${new Date(Number(q.block.timestamp) * 1000).toISOString()}\n\nThis pool price is not the real stock price. The estimate can change and does not check your available balance. USDT is separate from Demo USD.\n\nBuying and selling are not enabled yet. No order, approval or transaction was created.`;
    const current = db.prepare("SELECT status FROM wa_accounts WHERE id=?").get(account) as
      | { status: string }
      | undefined;
    if (current?.status !== "active")
      return text("Your account changed. Please request the quote again.");
    const stored = saveStockQuote(db, key, account, messageId, body, {
      symbol,
      side,
      amountIn: q.amountIn.toString(),
      amountOut: q.amountOut.toString(),
      block: q.block.number.toString(),
      timestamp: Number(q.block.timestamp),
      chainId: 46630,
    });
    return text(stored.body);
  } catch {
    return text(
      "I couldn’t get a reliable stock quote. Use an input above zero and at most 1,000 tokens (up to 6 decimals for USDT or 18 for stock tokens). If the amount is valid, the pool or network may be unavailable. No trade was submitted.",
    );
  }
}
