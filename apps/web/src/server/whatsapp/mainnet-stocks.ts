import { ensureMainnetWallet } from "../stocks/mainnet-wallet";
import { mainnetWallet } from "../stocks/mainnet-orders";
import type { DatabaseSync } from "node:sqlite";
import { formatEther, formatUnits, getAddress } from "viem";
import {
  MAINNET_ASSETS,
  MAINNET_CHAIN_ID,
  MAINNET_EXECUTION_READY,
  MAINNET_NATIVE_SYMBOL,
  MAINNET_NETWORK_NAME,
  MAINNET_QUOTE,
  type MainnetStock,
} from "../networks/chain";
import {
  MainnetReadError,
  mainnetPortfolio,
  mainnetPrice,
  verifiedMainnetRegistry,
} from "../stocks/mainnet";
import { text } from "./menu";
import {
  mainnetReferencePrice,
  ReferencePriceError,
  referenceDollars,
} from "../stocks/reference-price";

export const mainnetTradingMessage = () =>
  MAINNET_EXECUTION_READY && process.env.MAINNET_STOCK_TRADING_ENABLED === "true"
    ? "Trades need your confirmation."
    : "Trading is currently disabled.";

function priceAge(asOf: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - asOf) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export async function mainnetReferencePriceReply(symbol?: MainnetStock, forceRefresh = false) {
  const symbols = symbol ? [symbol] : (Object.keys(MAINNET_ASSETS) as MainnetStock[]);
  const lines = await Promise.all(
    symbols.map(async (ticker) => {
      try {
        const price = await mainnetReferencePrice(ticker, forceRefresh);
        const status = price.cachedFallback
          ? "; saved price — refresh temporarily unavailable"
          : price.marketOpen
            ? ""
            : "; trading paused for this token";
        return `${MAINNET_ASSETS[ticker].name} (${ticker}): *≈ ${referenceDollars(price.value, price.decimals)} / token*\nUpdated ${priceAge(price.asOf)}${status}`;
      } catch (error) {
        const code = error instanceof ReferencePriceError ? error.code : "source_unavailable";
        console.warn("Stock reference price unavailable", { symbol: ticker, code });
        const reason =
          code === "provider_busy"
            ? "price provider temporarily busy"
            : code === "trading_halted"
              ? "pricing paused for this asset"
              : code === "asset_changed" || code === "invalid_data"
                ? "could not verify the price data"
                : "price sources temporarily unreachable";
        return `${ticker}: price unavailable (${reason})`;
      }
    }),
  );
  return text(
    "📈 *Stock token prices · USD*\n\n" +
      lines.join("\n\n") +
      "\n\nBinance reference prices. Your final quote, including fees, appears before you confirm." +
      "\nReply ‘try again’ to refresh, or ‘all’ for every stock.",
  );
}

export async function mainnetStockListReply() {
  try {
    await verifiedMainnetRegistry();
    return text(
      `Stock tokens on ${MAINNET_NETWORK_NAME}\n\n` +
        Object.entries(MAINNET_ASSETS)
          .map(([symbol, a]) => `• ${a.name} (${symbol})`)
          .join("\n") +
        "\n\nEach comes from three issuers (bStocks, Ondo and xStocks). Sharebloom compares them and trades the fairest price.\n\nAsk for prices, your holdings, or a trade.\n" +
        mainnetTradingMessage(),
    );
  } catch {
    return text(
      "I couldn’t verify the mainnet token registry right now. Please try again. No transaction was submitted.",
    );
  }
}
export async function mainnetPortfolioReply(db: DatabaseSync, account: string) {
  const read = () => {
    const trading = mainnetWallet(db, account);
    if (trading) return { status: "active", address: trading.address };
    return undefined;
  };
  const wallet = read();
  if (wallet?.status !== "active" || !wallet.address)
    return text("Ask ‘Show my mainnet wallet’ to set up your mainnet wallet first.");
  try {
    const result = await mainnetPortfolio(getAddress(wallet.address));
    const current = read();
    if (current?.status !== "active" || current.address !== wallet.address)
      return text("Your account changed. Please request the portfolio again.");
    // List held stocks only; the catalogue is long and zero rows add noise.
    const stocks = result.balances.filter((a) => a.ticker && a.balance > 0n);
    const quote = result.balances.find((a) => a.address === MAINNET_QUOTE.address);
    const stockLines = stocks.length
      ? stocks
          .map((a) => `${a.ticker} · ${a.symbol} (${a.issuer}): ${a.formatted} tokens`)
          .join("\n")
      : "No stock tokens yet.";
    return text(
      `Your Sharebloom holdings · ${MAINNET_NETWORK_NAME}\n\n${stockLines}\n${MAINNET_QUOTE.symbol}: ${quote?.formatted ?? "0"}\n${MAINNET_NATIVE_SYMBOL}: ${formatEther(result.native)}\n\nWallet: ${wallet.address}\nStock quantities shown are raw token balances.`,
    );
  } catch {
    return text(
      "I couldn’t read reliable mainnet balances right now. Please try again. No transaction was submitted.",
    );
  }
}
export async function mainnetPriceReply(
  symbol: MainnetStock,
  side: "buy" | "sell",
  amount: string,
) {
  try {
    const p = await mainnetPrice(symbol, side, amount);
    return text(
      `${symbol} · ${side} preview\n${MAINNET_NETWORK_NAME}\nIssuer: ${p.variant.issuer} (${p.variant.symbol}) · fairest of ${p.evaluations.length}\n\nSpend: ${formatUnits(p.sellAmount, p.sellDecimals)} ${side === "buy" ? MAINNET_QUOTE.symbol : p.variant.symbol}\nEstimated receive: ${formatUnits(p.buyAmount, p.buyDecimals)} ${side === "buy" ? p.variant.symbol : MAINNET_QUOTE.symbol}\nNetwork fee calculated at trade review\n\n${p.provider} · ${new Date(Number(p.timestamp) * 1000).toISOString().slice(11, 19)} UTC\nEstimate only; no trade created.`,
    );
  } catch (error) {
    const code = error instanceof MainnetReadError ? error.code : "unavailable";
    if (code === "quote_busy")
      return text(
        "The price provider is temporarily busy. Please request the preview again shortly. No order was created.",
      );
    if (code === "no_liquidity")
      return text(
        "The provider returned no mainnet liquidity for this pair and amount. No order was created.",
      );
    if (code === "invalid_amount")
      return text(
        `Give a positive input amount up to 1,000: ${MAINNET_QUOTE.symbol} for a buy, or stock-token quantity for a sell.`,
      );
    if (code === "no_fair_price")
      return text(
        "No issuer (bStocks, Ondo or xStocks) is offering a fair price for this stock right now, so I won't quote it. No order was created.",
      );
    return text(
      "I couldn’t get a verified mainnet price preview. The service or requested route may be unavailable. No order was created.",
    );
  }
}

export async function mainnetReceiveReply(db: DatabaseSync, account: string) {
  try {
    const wallet = await ensureMainnetWallet(db, account);
    return text(
      `Your ${MAINNET_NETWORK_NAME} funding address\n\n${wallet.address}\n\n${MAINNET_NETWORK_NAME} (chain ${MAINNET_CHAIN_ID}) only.\nSend ${MAINNET_QUOTE.symbol} (BEP-20) for purchases and a little ${MAINNET_NATIVE_SYMBOL} for network fees.\n${mainnetTradingMessage()}`,
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "mainnet_policy_required")
      return text("Mainnet wallet setup is not available yet. Your testnet wallet is separate.");
    if (code === "account_not_active")
      return text("An active Sharebloom account is required. Type Menu to get started.");
    return text(
      "I couldn’t finish checking your mainnet wallet. Ask ‘Show my mainnet wallet’ again shortly. No funds were sent.",
    );
  }
}
