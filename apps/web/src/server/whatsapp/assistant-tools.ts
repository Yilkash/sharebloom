import {
  MAINNET_STOCK_ALIAS_PATTERN,
  mainnetStockForUnit,
  mainnetStockMentions,
} from "../stocks/stock-language";
import { mainnetPaymentReview } from "./mainnet-payments";
import { mainnetWallet } from "../stocks/mainnet-orders";
import { mainnetRpc } from "../stocks/mainnet-trade";
import { erc20Abi, formatEther } from "viem";
import { MAINNET_QUOTE } from "../networks/chain";
import { mainnetTradeReviewReply, mainnetTradeStatusReply } from "../stocks/mainnet-orders";
import { normalizePhone } from "./phone-recipients";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { isAddress, parseUnits, zeroAddress } from "viem";
import { seal, unseal } from "./config";
import { text, actionFor } from "./menu";
import { balanceReply } from "./balance";
import { paymentReply, activePaymentReply, PAYMENT_TOKEN, type Payment } from "./payments";
import { reviewPayment } from "./payment-runner";
import { contactsReply, contactByName, contactList } from "./contacts";
import { readyAccount, walletAddress } from "./wallet-setup";

import {
  MAINNET_ASSETS,
  MAINNET_STOCK_SYMBOLS,
  mainnetStockChoices,
  type MainnetStock,
} from "../networks/chain";
import {
  mainnetStockListReply,
  mainnetPortfolioReply,
  mainnetPriceReply,
  mainnetReceiveReply,
  mainnetReferencePriceReply,
  mainnetTradingMessage,
  stockProfileReply,
} from "./mainnet-stocks";
import { mainnetReferencePrice, referenceDollars } from "../stocks/reference-price";
import { formatUnits } from "viem";
import { STOCKS, type StockSymbol } from "../stocks/market";
import { stockListReply, stockPortfolioReply, stockQuoteReply } from "./stocks";

type Task = {
  kind: "payment" | "contact" | "stock" | "mainnet_stock" | "mainnet_payment";
  desiredQuantity?: string;
  priceScope?: "all" | MainnetStock;
  mainnetSymbol?: MainnetStock;
  symbol?: StockSymbol;
  side?: "buy" | "sell";
  unit?: string;
  recipient?: string;
  amount?: string;
  name?: string;
  address?: string;
};
// Only continue a saved read-only price request. Never repeat a trade from “retry”.
export function referencePriceFollowup(
  task: Task | null,
  input: string,
): { symbol?: MainnetStock } | null {
  if (task?.kind !== "mainnet_stock" || !task.priceScope) return null;
  const command = input
    .trim()
    .toLowerCase()
    .replace(/[.!?]+$/, "");
  if (
    /^(?:all|all of them|all three|all 3|all stocks|all prices|all their prices)(?: please)?$/.test(
      command,
    )
  )
    return {};
  if (/^(?:please )?(?:try again|retry|again|refresh|refresh prices)(?: please)?$/.test(command))
    return task.priceScope === "all" ? {} : { symbol: task.priceScope };
  return null;
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SMALL =
  "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(
    " ",
  );
const TENS = "twenty thirty forty fifty sixty seventy eighty ninety".split(" ");
/** Write spoken whole numbers as digits ("twenty five" -> "25") so amounts can be matched. */
export function spokenNumbers(text: string) {
  const word = `(?:${[...TENS, ...SMALL].join("|")})`;
  return text.replace(
    new RegExp(
      `\\b(${word})(?:[\\s-]+(${SMALL.slice(1, 10).join("|")}))?(?:\\s+(hundred|thousand))?\\b`,
      "gi",
    ),
    (_m, first: string, unit?: string, scale?: string) => {
      const f = first.toLowerCase();
      let n = SMALL.includes(f) ? SMALL.indexOf(f) : (TENS.indexOf(f) + 2) * 10;
      if (unit) n += SMALL.indexOf(unit.toLowerCase());
      if (scale) n *= scale.toLowerCase() === "hundred" ? 100 : 1000;
      return String(n);
    },
  );
}
const field = z.string().trim().min(1).max(100);
const amountField = z.string().regex(/^(?:0|[1-9]\d{0,3})(?:\.\d{1,6})?$/);
const tool = (
  name: string,
  description: string,
  properties: Record<string, unknown> = {},
  required: string[] = [],
) => ({
  type: "function",
  function: {
    name,
    description,
    parameters: { type: "object", properties, required, additionalProperties: false },
  },
});
const allAssistantTools = [
  tool(
    "get_mainnet_receive_address",
    "Show the authenticated user's BNB Chain funding address for USDT and BNB. Provisions the first wallet only if missing; otherwise reuses the existing wallet. One mainnet wallet per account: cannot create another wallet or change the address. Use only when the user requests their address, funding or deposit instructions, not for complaints, explanations, or second-wallet requests; mainnet is the default. Never accepts an address or account argument. Does not trade or transfer funds.",
  ),
  tool(
    "get_mainnet_trade_status",
    "Read mainnet stock trade reviews, approval progress and confirmed swap receipts. Use for stock trade status, never payment history.",
  ),
  tool(
    "prepare_mainnet_stock_trade",
    "Prepare a mainnet stock trade review only when the user asks to buy/sell, not for informational prices, examples or previews. Stocks default to mainnet. Requires stock, direction and input amount; omitted buy currency means USDT. Buys are limited to 1,000 USDT and sells to 1,000 stock tokens per trade. Never reduce or split a larger request automatically. Reuse the current mainnet stock task. Omit missing fields. Sells return USDT; interpret “sell 0.001 Apple shares” as 0.001 AAPL stock tokens. Never reuse a buy budget as a sell quantity. Never executes; a separate confirmation button is mandatory. Setup may be unavailable.",
    {
      symbol: { type: "string", enum: MAINNET_STOCK_SYMBOLS },
      side: { type: "string", enum: ["buy", "sell"] },
      amount: { type: "string" },
      unit: { type: "string" },
    },
  ),
  tool(
    "stock_help",
    "Show Sharebloom's supported stock catalogue and explain price previews versus execution. Use for general stock/share/equity availability or capabilities, including misspellings, without requiring a network or amount. For a specific unsupported company, answer directly that it is unsupported rather than calling this tool. For a purchase request, collect the stock and budget with the trade preparation tool. This is the configured catalogue, not a live tradability check.",
  ),
  tool(
    "list_mainnet_stocks",
    `Verify and list official mainnet stock token addresses (${MAINNET_STOCK_SYMBOLS.join(", ")}). Read-only catalogue.`,
  ),
  tool(
    "get_mainnet_stock_portfolio",
    "Read mainnet holdings at the user's existing Sharebloom address, defaulting to mainnet unless testnet is explicitly requested. Does not activate a mainnet wallet.",
  ),
  tool(
    "preview_mainnet_stock_price",
    "Read an indicative KyberSwap mainnet price. Default network is mainnet. Omitted buy currency means USDT; sells use stock-token quantity. Reuse the current task for preview follow-ups. Explicit other currencies must not be substituted. Omit missing fields so the tool can ask. No order or signing.",
    {
      symbol: { type: "string", enum: MAINNET_STOCK_SYMBOLS },
      side: { type: "string", enum: ["buy", "sell"] },
      amount: { type: "string" },
      unit: { type: "string" },
    },
  ),
  tool(
    "get_stock_price",
    "Show USD reference prices per BNB Chain stock token with a short update age. Preserve older/saved labels. These are not executable USDT trade quotes. For price questions without a budget or direction: Tesla price, show stock prices. Omit symbol to show all supported stocks. Never creates a trade.",
    { symbol: { type: "string", enum: MAINNET_STOCK_SYMBOLS } },
  ),
  tool(
    "get_stock_profile",
    "Show company facts for one supported stock: the past 7 days' price trend, 52-week range, market cap, P/E and dividend yield, from Binance. Use for questions like 'tell me about Apple', 'how has Tesla done this week', 'what is Microsoft's P/E'. Read only; never a trade or a quote.",
    { symbol: { type: "string", enum: MAINNET_STOCK_SYMBOLS } },
    ["symbol"],
  ),
  tool(
    "list_test_stocks",
    "List supported test stocks and current read-only capabilities. Trading is disabled.",
  ),
  tool(
    "get_stock_portfolio",
    "Read actual test-stock and USDT balances in the user's Sharebloom wallet, not their external MetaMask wallet.",
  ),
  tool(
    "quote_stock",
    "Collect a read-only buy/sell estimate. Omit missing fields; reuse the stock task. Buy input must be explicit USDT budget; sell input must be stock-token quantity. Never convert USD, Demo USD or requested stock output into USDT. No orders or confirmations are created.",
    {
      symbol: { type: "string", enum: ["TSLA", "AMD", "NFLX", "AMZN"] },
      side: { type: "string", enum: ["buy", "sell"] },
      amount: { type: "string" },
      unit: {
        type: "string",
        description: "User-stated input unit, e.g. USDT, TSLA, USD or Demo USD; omit if unstated.",
      },
    },
  ),
  tool(
    "get_balance",
    "Read mainnet USDT, BNB and stock balances by default. Testnet only when explicitly requested.",
  ),
  tool(
    "get_recent_payments",
    "Read latest payment statuses and receipts; use for whether a payment went through.",
  ),
  tool(
    "get_receive_address",
    "Show the user's own BNB Chain receiving address by default. Reuses their wallet; cannot create another or replace it. Not for questions about why the address is unchanged.",
  ),
  tool(
    "get_account",
    "Show account wallet readiness. Cannot create an additional wallet, replace a wallet or rotate its address. Explain those limitations without a tool.",
  ),
  tool("list_contacts", "Display the user's saved contacts locally."),
  tool("find_contact", "Look up a saved contact locally by name.", { name: { type: "string" } }, [
    "name",
  ]),
  tool(
    "check_affordability",
    "Check a USDT amount against the mainnet balance; fees are checked at review. Explicit testnet requests use Demo USD. Never prepares or sends a payment.",
    { amount: { type: "string" } },
    ["amount"],
  ),
  tool(
    "prepare_payment",
    "Collect a payment recipient and amount; omit missing fields. Reuse the current payment task. Always requires separate Confirm payment; never sends.",
    { recipient: { type: "string" }, amount: { type: "string" } },
  ),
  tool(
    "prepare_contact",
    "Collect a contact name and wallet address. Omit missing fields. Prepares Save contact confirmation; never saves directly.",
    { name: { type: "string" }, address: { type: "string" } },
  ),
  tool(
    "delete_contact",
    "Prepare a delete confirmation for an explicitly requested saved contact.",
    { name: { type: "string" } },
    ["name"],
  ),
  tool(
    "cancel_task",
    "Discard an unfinished draft or unconfirmed review. Never cancels a submitted transaction.",
  ),
];
// Sharebloom has no testnet mode; Steward's Robinhood testnet stock tools stay unexposed.
const TESTNET_ONLY_TOOLS = ["list_test_stocks", "get_stock_portfolio", "quote_stock"];
export const assistantTools = allAssistantTools.filter(
  (t) => !TESTNET_ONLY_TOOLS.includes(t.function.name),
);
export function currentTask(
  db: DatabaseSync,
  key: Buffer,
  account: string,
  consent: string,
): Task | null {
  const row = db
    .prepare(
      "SELECT payload FROM wa_assistant_tasks WHERE account_id=? AND consent_hash=? AND expires>?",
    )
    .get(account, consent, Date.now()) as { payload: string } | undefined;
  return row ? unseal<Task>(row.payload, key) : null;
}
export async function runAssistantTool(
  db: DatabaseSync,
  key: Buffer,
  account: string,
  phone: string,
  messageId: string,
  consent: string,
  input: string,
  evidence: string,
  name: string,
  args: unknown,
) {
  const task = currentTask(db, key, account, consent);
  const clear = () => db.prepare("DELETE FROM wa_assistant_tasks WHERE account_id=?").run(account);
  const save = (t: Task) =>
    db
      .prepare(
        "INSERT INTO wa_assistant_tasks(account_id,consent_hash,payload,expires) VALUES(?,?,?,?) ON CONFLICT(account_id) DO UPDATE SET consent_hash=excluded.consent_hash,payload=excluded.payload,expires=excluded.expires",
      )
      .run(account, consent, seal(t, key), Date.now() + 600000);
  const literal = (s: string) =>
    new RegExp(
      "(?<![\\p{L}\\p{N}])" + escape(s.normalize("NFKC")) + "(?![\\p{L}\\p{N}])",
      "iu",
    ).test(evidence.normalize("NFKC"));
  const amountLiteral = (s: string) =>
    new RegExp("(?<![\\p{L}\\p{N}.])" + escape(s) + "(?![\\d.])", "iu").test(
      spokenNumbers(evidence.replace(/0x[a-f0-9]{40}/gi, "")),
    );
  const pay = (value: string) =>
    paymentReply(db, key, { from: phone, id: messageId, input: value });
  if (
    [
      "get_mainnet_receive_address",
      "get_mainnet_trade_status",
      "stock_help",
      "list_test_stocks",
      "get_stock_portfolio",
      "get_balance",
      "get_recent_payments",
      "get_receive_address",
      "get_account",
      "list_contacts",
      "cancel_task",
    ].includes(name)
  ) {
    z.object({}).strict().parse(args);
    if (name === "get_mainnet_receive_address") {
      if (/\b(?:testnet|46630)\b/i.test(input))
        return text("Please choose one network: mainnet or testnet.");
      return mainnetReceiveReply(db, account);
    }
    if (name === "get_mainnet_trade_status") return mainnetTradeStatusReply(db, account);
    if (name === "stock_help")
      return text(
        "Stock tokens on BNB Chain\n\n" +
          MAINNET_STOCK_SYMBOLS.map((s) => `• ${MAINNET_ASSETS[s].name} (${s})`).join("\n") +
          "\n\n" +
          "Buy example: Buy Apple with 0.2 USDT.\n" +
          "Sell example: Sell 0.001 Apple tokens for USDT.\n" +
          mainnetTradingMessage(),
      );
    if (name === "list_test_stocks") return stockListReply();
    if (name === "get_stock_portfolio") return stockPortfolioReply(db, account);
    if (name === "get_balance")
      return /\b(?:testnet|demo|46630)\b/i.test(input)
        ? balanceReply(db, key, phone)
        : mainnetPortfolioReply(db, account);
    if (name === "get_recent_payments" && !/\b(?:testnet|demo|46630)\b/i.test(input))
      return mainnetTradeStatusReply(db, account);
    if (name === "get_recent_payments")
      return pay("Recent activity") ?? text("Create your wallet first to see payment activity.");
    if (name === "get_receive_address" || name === "get_account") {
      if (!/\b(?:testnet|demo|46630)\b/i.test(input)) return mainnetReceiveReply(db, account);
      if (/\b(?:mainnet|4663)\b/i.test(input)) {
        if (/\b(?:testnet|46630)\b/i.test(input))
          return text("Please choose one network: mainnet or testnet.");
        return mainnetReceiveReply(db, account);
      }
      const wallet = walletAddress(db, account);
      return wallet
        ? readyAccount(wallet.address)
        : text(
            "Your account is created, but the wallet is not ready. Choose My account from Menu to finish wallet setup.",
          );
    }
    if (name === "list_contacts") return contactList(db, key, account, "manage");
    db.prepare(
      "UPDATE wa_mainnet_orders SET state='cancelled',confirmation_hash=NULL WHERE account_id=? AND state='review'",
    ).run(account);
    clear();
    db.prepare("DELETE FROM wa_mainnet_payment_drafts WHERE account_id=?").run(account);
    db.prepare("DELETE FROM wa_contact_sessions WHERE account_id=?").run(account);
    db.prepare("DELETE FROM wa_payment_language_entries WHERE account_id=?").run(account);
    return pay("Cancel") ?? text("Draft cancelled. Nothing was sent.");
  }
  if (name === "get_stock_profile") {
    const a = z
      .object({ symbol: z.enum(MAINNET_STOCK_SYMBOLS) })
      .strict()
      .safeParse(args);
    const mentions = mainnetStockMentions(input);
    // A stock the user named wins; otherwise trust the model (e.g. "the iPhone company")
    // unless the conversation names a different stock.
    const said = mainnetStockMentions(evidence);
    const symbol =
      mentions.length === 1
        ? mentions[0]
        : a.success && (said.length === 0 || said.includes(a.data.symbol))
          ? a.data.symbol
          : undefined;
    if (!symbol) return text(`Which stock: ${mainnetStockChoices()}?`);
    return stockProfileReply(symbol);
  }
  if (
    [
      "list_mainnet_stocks",
      "get_stock_price",
      "get_mainnet_stock_portfolio",
      "preview_mainnet_stock_price",
      "prepare_mainnet_stock_trade",
    ].includes(name)
  ) {
    if (/\b(?:testnet|46630)\b/i.test(input) && !/\b(?:mainnet|4663)\b/i.test(input))
      return text(
        "You asked for testnet. Please request a testnet stock quote or portfolio; I won’t substitute mainnet data.",
      );
    if (name === "list_mainnet_stocks") {
      z.object({}).strict().parse(args);
      return mainnetStockListReply();
    }
    if (name === "get_mainnet_stock_portfolio") {
      z.object({}).strict().parse(args);
      return mainnetPortfolioReply(db, account);
    }
    // Accept bounded numeric input here; business limits get a useful reply below.
    // A large amount must not throw into the assistant's generic service-error handler.
    const parsed = z
      .object({
        symbol: z.enum(MAINNET_STOCK_SYMBOLS).optional(),
        side: z.enum(["buy", "sell"]).optional(),
        amount: z.string().max(100).optional(),
        unit: field.optional(),
      })
      .strict()
      .safeParse(args);
    if (!parsed.success)
      return text(
        `Please specify ${mainnetStockChoices()} and a plain numeric amount. Buys support up to 1,000 USDT; sells support up to 1,000 stock tokens per trade.`,
      );
    const a = parsed.data;
    const prior = task?.kind === "mainnet_stock" ? task : undefined;
    const priceFollowup = referencePriceFollowup(task, input);
    const mentions = mainnetStockMentions(input);
    const broadPrices =
      name === "get_stock_price" &&
      ((/\bprices\b/i.test(input) && mentions.length === 0) ||
        (priceFollowup !== null && priceFollowup.symbol === undefined));
    if (mentions.length > 1 && name !== "get_stock_price")
      return text(`Which stock should I use for this request: ${mainnetStockChoices()}?`);
    const named = mentions.length === 1 ? mentions[0] : undefined;
    const symbol = broadPrices ? undefined : (named ?? a.symbol ?? prior?.mainnetSymbol);
    // Trust the model's stock (e.g. "the iPhone company") unless the user named a different
    // one. The trade review shows the company name before anything can be confirmed.
    const said = mainnetStockMentions(evidence);
    if (!broadPrices && a.symbol && said.length > 0 && !said.includes(a.symbol))
      return text(`Which stock: ${mainnetStockChoices()}?`);
    if (a.amount && !amountLiteral(a.amount))
      return text("How much would you like to spend or sell?");
    const explicitSide = /\bbuy\b/i.test(input)
      ? "buy"
      : /\bsell\b/i.test(input)
        ? "sell"
        : undefined;
    const side = explicitSide ?? a.side ?? prior?.side;
    const changed =
      prior && ((symbol && symbol !== prior.mainnetSymbol) || (side && side !== prior.side));
    // A previous buy budget must never become a sell quantity (or vice versa).
    const draft: Task = {
      ...(prior ?? {}),
      kind: "mainnet_stock",
      mainnetSymbol: symbol,
      side,
      desiredQuantity: changed ? undefined : prior?.desiredQuantity,
      amount: a.amount ?? (changed ? undefined : prior?.amount),
      unit: a.unit ?? (changed || a.amount ? undefined : prior?.unit),
    };
    if (
      changed &&
      a.amount &&
      !new RegExp("(?<![\\p{L}\\p{N}.])" + escape(a.amount) + "(?![\\d.])", "iu").test(
        spokenNumbers(input),
      )
    ) {
      draft.amount = undefined;
      draft.unit = undefined;
    }
    const quantity = new RegExp(
      `(?<![\\p{L}\\p{N}.+-])(\\d+(?:\\.\\d+)?)\\s*(?:shares?|tokens?|${MAINNET_STOCK_ALIAS_PATTERN})(?![\\p{L}\\p{N}])`,
      "iu",
    ).exec(input);
    const budget =
      /\b(?:with|spend|budget|for|use)\s+\$?(\d+(?:\.\d+)?)\b|\$(\d+(?:\.\d+)?)\b|\b(\d+(?:\.\d+)?)\s*(?:USDT|usd|dollars?)\b/i.exec(
        input,
      );
    if (quantity && !budget) {
      draft.desiredQuantity = quantity[1];
      draft.amount = undefined;
      draft.unit = "shares";
    }
    if (
      prior?.desiredQuantity &&
      draft.side === "buy" &&
      !changed &&
      /^\d+(?:\.\d+)?$/.test(input.trim())
    ) {
      draft.desiredQuantity = undefined;
      draft.amount = input.trim();
      draft.unit = "USDT";
      draft.side = "buy";
    }
    if (budget) {
      draft.desiredQuantity = undefined;
      draft.amount = budget[1] ?? budget[2] ?? budget[3];
      draft.unit = "USDT";
    }
    if (name === "get_stock_price") {
      save({ kind: "mainnet_stock", mainnetSymbol: symbol, priceScope: symbol ?? "all" });
      return mainnetReferencePriceReply(symbol, priceFollowup !== null);
    }
    if (draft.side === "sell" && /\b(?:all|everything|entire|whole)\b/i.test(input)) {
      draft.amount = undefined;
      draft.desiredQuantity = undefined;
      draft.unit = symbol;
      save(draft);
      return text(
        symbol
          ? `How many ${symbol} tokens would you like to sell? You can ask for your balance first.`
          : `Which stock would you like to sell: ${mainnetStockChoices()}?`,
      );
    }
    delete draft.priceScope;
    // "usd", "dollars" and "$" all mean the app's dollar token (USDT).
    if (draft.unit && /^(?:usd|usdt|dollars?|\$)$/i.test(draft.unit.trim())) draft.unit = "USDT";
    if (!draft.unit && draft.side) draft.unit = draft.side === "buy" ? "USDT" : symbol;
    // USDT is the trading currency; other currency names must not become a USDT budget.
    if (/\b(?:demo\s*usd|dusd|usdc|usdg|eth|bnb)\b/i.test(input)) draft.unit = "unsupported";
    save(draft);
    if (!symbol) return text(`Which stock: ${mainnetStockChoices()}?`);
    if (!draft.side && !draft.amount && name === "preview_mainnet_stock_price")
      return mainnetReferencePriceReply(symbol);
    if (draft.desiredQuantity) {
      if (draft.side === "sell") {
        draft.amount = draft.desiredQuantity;
        draft.unit = symbol;
        draft.desiredQuantity = undefined;
        save(draft);
      } else {
        draft.amount = undefined;
        save(draft);
        let value = "";
        try {
          const price = await mainnetReferencePrice(symbol);
          const indicative = (price.value * parseUnits(draft.desiredQuantity, 18)) / 10n ** 18n;
          const updated = new Date(price.asOf).toISOString().replace("T", " ").slice(0, 16);
          value = ` Reference value: ≈ ${referenceDollars(indicative, price.decimals)} USD (${price.source}, updated ${updated} UTC${price.cachedFallback ? "; saved price, refresh unavailable" : ""}). This is not a USDT purchase quote.`;
        } catch {
          /* Preserve quantity intent even when a public quote is unavailable. */
        }
        return text(
          `You want ${draft.desiredQuantity} ${symbol} tokens.${value}\n\nSharebloom buys by USDT budget, up to 1,000 USDT per trade. It cannot place an order for an exact token quantity.\n\nHow much USDT would you like to spend?`,
        );
      }
    }
    if (!draft.side) return text("Would you like to buy or sell?");
    if (!draft.amount)
      return text(
        draft.side === "buy"
          ? "How much USDT would you like to spend?"
          : `How many ${symbol} tokens would you like to sell?`,
      );
    if (draft.side === "sell" && /^(?:shares?|tokens?)$/i.test(draft.unit ?? "")) {
      draft.unit = symbol;
      save(draft);
    }
    // "Sell 0.5 Microsoft" may arrive with the company name as the unit.
    if (draft.side === "sell" && mainnetStockForUnit(draft.unit) === symbol) draft.unit = symbol;
    const expected = draft.side === "buy" ? "USDT" : symbol;
    if (draft.unit?.toUpperCase() !== expected) return text(`Enter the amount in ${expected}.`);
    const decimals = draft.side === "buy" ? MAINNET_QUOTE.decimals : 18;
    const plainAmount = new RegExp(`^(?:0|[1-9]\\d{0,29})(?:\\.\\d{1,${decimals}})?$`).test(
      draft.amount,
    );
    const inputAmount = plainAmount ? parseUnits(draft.amount, decimals) : undefined;
    if (
      inputAmount === undefined ||
      inputAmount <= 0n ||
      inputAmount > parseUnits("1000", decimals)
    ) {
      // Keep stock and direction for a corrected budget, but never reuse the rejected amount.
      draft.amount = undefined;
      save(draft);
      const limit =
        draft.side === "buy"
          ? `Sharebloom currently supports up to 1,000 USDT per stock purchase. What USDT budget would you like to use for ${symbol}?`
          : `Sharebloom currently supports selling up to 1,000 ${symbol} tokens per trade. How many would you like to sell?`;
      return text(
        (inputAmount === undefined || inputAmount <= 0n
          ? `Enter a positive amount with at most ${decimals} decimal places.\n\n`
          : "") +
          limit +
          "\nNo trade was created.",
      );
    }
    if (
      name === "prepare_mainnet_stock_trade" &&
      !/\b(?:preview|quote|what if|example)\b/i.test(input) &&
      !(/\bhow much\b/i.test(input) && !explicitSide)
    )
      return mainnetTradeReviewReply(
        db,
        key,
        account,
        phone,
        messageId,
        symbol,
        draft.side,
        draft.amount,
      );
    return mainnetPriceReply(symbol, draft.side, draft.amount);
  }

  if (name === "quote_stock") {
    if (/\b(?:mainnet|4663)\b/i.test(input))
      return text(
        "This is a testnet quote tool. For mainnet, ask for a mainnet stock price preview in USDT.",
      );
    const a = z
      .object({
        symbol: z.enum(["TSLA", "AMD", "NFLX", "AMZN"]).optional(),
        side: z.enum(["buy", "sell"]).optional(),
        amount: z
          .string()
          .regex(/^(?:0|[1-9]\d{0,3})(?:\.\d{1,18})?$/)
          .optional(),
        unit: field.optional(),
      })
      .strict()
      .parse(args);
    if (a.symbol && !literal(a.symbol) && !literal(STOCKS[a.symbol].name))
      return text("Which test stock do you mean: TSLA, AMD, NFLX or AMZN?");
    if ((a.amount && !amountLiteral(a.amount)) || (a.unit && !literal(a.unit)))
      return text(
        "Please specify the amount and input token, for example ‘Buy Tesla with 2 USDT’.",
      );
    const draft: Task = { ...(task?.kind === "stock" ? task : {}), kind: "stock", ...a };
    // A changed side or stock cannot silently inherit a previous input quantity/unit.
    if (
      task?.kind === "stock" &&
      ((a.side && a.side !== task.side) || (a.symbol && a.symbol !== task.symbol))
    ) {
      draft.amount = a.amount;
      draft.unit = a.unit;
    }
    // Require the user to restate units with a changed amount instead of reusing
    // a prior USDT budget for a newly requested stock-token quantity.
    if (a.amount && !a.unit) draft.unit = undefined;
    if (/\b(?:demo\s*usd|dusd|usdc|usdt|dollars?|usd)\b/i.test(input)) {
      draft.unit = "unsupported";
    }
    save(draft);
    if (!draft.symbol) return text("Which test stock: TSLA, AMD, NFLX or AMZN?");
    if (!draft.side)
      return text("Would you like a buy or sell estimate? Trading is not enabled yet.");
    if (!draft.amount)
      return text(
        draft.side === "buy"
          ? "How much test USDT would you spend? Include USDT with the amount. Demo USD is a different token."
          : `How many ${draft.symbol} test tokens would you sell? Include ${draft.symbol} with the amount.`,
      );
    const expected = draft.side === "buy" ? "USDT" : draft.symbol;
    if (!draft.unit || draft.unit.toUpperCase() !== expected)
      return text(
        `For this ${draft.side} estimate, give the input amount in ${expected}, for example ‘2 ${expected}’. Demo USD and real dollars are not converted automatically. Trading is not enabled yet.`,
      );
    const result = await stockQuoteReply(
      db,
      key,
      account,
      messageId,
      draft.symbol,
      draft.side,
      draft.amount,
    );
    clear();
    return result;
  }
  if (name === "find_contact" || name === "delete_contact") {
    const a = z.object({ name: field }).strict().parse(args);
    if (!literal(a.name)) return text("What is the saved contact’s name?");
    const c = contactByName(db, key, account, a.name);
    if (!c)
      return text("I couldn’t find that saved contact. Check the name or open Manage contacts.");
    if (name === "find_contact")
      return text(`${c.name}\n${c.address}\nVerify this address on BNB Chain before sending.`);
    if (!/\b(?:delete|remove|forget)\b/i.test(input))
      return text("To remove a contact, tell me which saved contact you want to delete.");
    clear();
    return contactsReply(db, key, account, "contact:delete:" + c.id)!;
  }
  if (name === "check_affordability") {
    const a = z.object({ amount: amountField }).strict().parse(args);
    if (!amountLiteral(a.amount) || parseUnits(a.amount, MAINNET_QUOTE.decimals) <= 0n)
      return text("What amount would you like me to check?");
    if (/\b(?:testnet|demo|46630)\b/i.test(input)) return balanceReply(db, key, phone, a.amount);
    const wallet = mainnetWallet(db, account);
    if (!wallet) return text("Ask for your receiving address to set up your mainnet wallet.");
    const [balance, eth] = await Promise.all([
      mainnetRpc.readContract({
        address: MAINNET_QUOTE.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [wallet.address as `0x${string}`],
      }),
      mainnetRpc.getBalance({ address: wallet.address as `0x${string}` }),
    ]);
    return text(
      `${balance >= parseUnits(a.amount, MAINNET_QUOTE.decimals) ? "Your USDT covers" : "Your USDT does not cover"} ${a.amount} USDT.\nBalance: ${formatUnits(balance, MAINNET_QUOTE.decimals)} USDT\nGas balance: ${formatEther(eth)} BNB\nFees are checked at review. Nothing sent.`,
    );
  }
  if (name === "prepare_contact") {
    const a = z.object({ name: field.optional(), address: field.optional() }).strict().parse(args);
    if (task?.kind !== "contact" && !/\b(?:save|add|store|remember|contact)\b/i.test(input))
      return text("Tell me the contact name and address you want to save.");
    if (
      (a.name && !literal(a.name)) ||
      (a.address && (!literal(a.address) || !isAddress(a.address)))
    )
      return text("Please provide the contact name and a valid full 0x wallet address.");
    const draft: Task = { ...(task?.kind === "contact" ? task : {}), kind: "contact", ...a };
    save(draft);
    if (!draft.name) return text("What name should I save this contact under?");
    if (!draft.address) return text(`What is ${draft.name}’s full 0x wallet address on BNB Chain?`);
    if (
      draft.name.length > 24 ||
      !/[\p{L}]/u.test(draft.name) ||
      !/^[\p{L}\p{N} .'-]+$/u.test(draft.name) ||
      actionFor(draft.name) ||
      /^(?:menu|cancel|send|help|settings|activity)$/i.test(draft.name)
    )
      return text(
        "Use a contact name up to 24 characters with letters, numbers, spaces, dots, apostrophes or hyphens.",
      );
    if (contactByName(db, key, account, draft.name))
      return text("That name is already saved. Use another name or edit it in Manage contacts.");
    const count = db
      .prepare("SELECT count(*) n FROM wa_contacts WHERE account_id=?")
      .get(account) as { n: number };
    if (count.n >= 100)
      return text("You have reached 100 contacts. Remove one before adding another.");
    // Existing contact tool validates the address and generates the confirmation.
    db.exec("SAVEPOINT assistant_contact");
    try {
      db.prepare("DELETE FROM wa_contact_sessions WHERE account_id=?").run(account);
      let result = contactsReply(db, key, account, "contact:add");
      const stage = () => {
        const r = db
          .prepare("SELECT payload FROM wa_contact_sessions WHERE account_id=?")
          .get(account) as { payload: string } | undefined;
        return r ? unseal<{ stage: string }>(r.payload, key).stage : null;
      };
      if (stage() === "name") result = contactsReply(db, key, account, draft.name);
      if (stage() === "address") result = contactsReply(db, key, account, draft.address);
      if (stage() === "review") clear();
      db.exec("RELEASE assistant_contact");
      return result ?? text("Use Manage contacts to continue.");
    } catch (e) {
      db.exec("ROLLBACK TO assistant_contact");
      db.exec("RELEASE assistant_contact");
      throw e;
    }
  }
  if (name !== "prepare_payment") throw Error("unsupported_tool");
  const a = z
    .object({ recipient: field.optional(), amount: amountField.optional() })
    .strict()
    .parse(args);
  if (!/\b(?:testnet|demo\s*usd|dusd|46630)\b/i.test(input) && task?.kind !== "payment") {
    if ((a.recipient && !literal(a.recipient)) || (a.amount && !amountLiteral(a.amount)))
      return text("Please give the recipient and exact USDT amount.");
    if (/\b(?:usdc|usdg|eth|bnb|btc|eur|gbp)\b/i.test(input))
      return text("Payments support USDT on BNB Chain. What USDT amount would you like to send?");
    const draft: Task = {
      ...(task?.kind === "mainnet_payment" ? task : {}),
      kind: "mainnet_payment",
      ...a,
    };
    if (
      task?.kind === "mainnet_payment" &&
      a.recipient &&
      a.recipient !== task.recipient &&
      !a.amount
    )
      draft.amount = undefined;
    save(draft);
    if (!draft.recipient)
      return text(
        "Who should receive USDT? Give a saved name, full international phone number or wallet address.",
      );
    if (!draft.amount) return text("How much USDT would you like to send?");
    return mainnetPaymentReview(db, key, account, phone, messageId, draft.recipient, draft.amount);
  }
  if (task?.kind !== "payment" && !/\b(?:send|pay|transfer|give)\b/i.test(input))
    return text(
      "Tell me who you want to pay and how much. A payment always needs the Confirm payment button.",
    );
  if (/(?<![a-z])(?:usdc|usdt|usdg|eth|btc|eur|gbp|ngn|naira|mainnet)(?![a-z])/i.test(input))
    return text("Only Demo USD on Robinhood testnet is supported. Nothing was prepared.");
  if ((a.recipient && !literal(a.recipient)) || (a.amount && !amountLiteral(a.amount)))
    return text(
      "Please specify the recipient and numeric amount so I can prepare the exact payment.",
    );
  const draft: Task = { ...(task?.kind === "payment" ? task : {}), kind: "payment", ...a };
  save(draft);
  if (!draft.recipient)
    return text(
      "Who should receive the Demo USD? Give a saved name, full international phone number or full 0x address.",
    );
  // Resolve saved names before requesting the amount; keep the user-provided
  // draft so an address correction does not lose the amount already supplied.
  const phoneRecipient = normalizePhone(draft.recipient);
  const directAddress = isAddress(draft.recipient);
  if (draft.recipient.toLowerCase().startsWith("0x") && !directAddress)
    return text(
      "That wallet address is incomplete or invalid. Please send the full 0x address. I’ll keep the other payment details; nothing was sent.",
    );
  const contact =
    !directAddress && !phoneRecipient ? contactByName(db, key, account, draft.recipient) : null;
  if (!directAddress && !phoneRecipient && !contact)
    return text(
      `I don’t have a saved contact named ${draft.recipient}. What is their full 0x wallet address or international phone number?${draft.amount ? ` I’ll keep the amount at ${draft.amount} Demo USD.` : ""}\n\nPhone-number recipients must have enabled lookup. Nothing was sent.`,
    );
  const destination = directAddress ? draft.recipient : contact?.address;
  const ownWallet = walletAddress(db, account);
  if (
    destination &&
    [ownWallet?.address, zeroAddress, PAYMENT_TOKEN].some(
      (address) => address?.toLowerCase() === destination.toLowerCase(),
    )
  )
    return text(
      "That recipient points to your own wallet or an unsupported address. Please give a different recipient’s wallet address. Nothing was sent.",
    );
  if (!draft.amount) return text(`How much Demo USD would you like to send to ${draft.recipient}?`);
  if (
    actionFor(draft.recipient) ||
    /^(?:menu|cancel|send|help|settings|activity)$/i.test(draft.recipient) ||
    draft.recipient.includes(":")
  )
    return text("Please give the recipient’s full 0x address.");
  let result: ReturnType<typeof paymentReply>;
  db.exec("BEGIN IMMEDIATE");
  try {
    const active = db
      .prepare(
        "SELECT * FROM wa_payments WHERE account_id=? AND state IN ('quoting','review','queued','preflight','submitting','unknown','broadcast') AND (expires>? OR state NOT IN ('quoting','review'))",
      )
      .get(account, Date.now()) as Payment | undefined;
    if (active) {
      const reply = activePaymentReply(db, active);
      clear();
      db.exec("COMMIT");
      return reply;
    }
    db.prepare("DELETE FROM wa_payment_sessions WHERE account_id=?").run(account);
    result = pay("Send payment");
    const stage = () =>
      (
        db.prepare("SELECT stage FROM wa_payment_sessions WHERE account_id=?").get(account) as
          | { stage: string }
          | undefined
      )?.stage;
    if (stage() === "address") result = pay(draft.recipient);
    if (stage() === "amount") result = pay(draft.amount);
    if (result && "payment_id" in result && typeof result.payment_id === "string") {
      db.prepare(
        "UPDATE wa_assistant_requests SET payment_id=? WHERE message_id=? AND account_id=?",
      ).run(result.payment_id, messageId, account);
      clear();
    }
    db.prepare("DELETE FROM wa_payment_sessions WHERE account_id=?").run(account);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  if (result && "payment_id" in result && typeof result.payment_id === "string")
    return reviewPayment(db, key, phone, result.payment_id);
  return result ?? text("I couldn’t prepare that payment. Nothing was sent.");
}
