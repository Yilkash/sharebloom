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
  binanceWeb3Configured,
  companyFacts,
  formatChange24h,
  marketChanges24h,
  rwaReferencePrices,
  sparkline,
} from "../stocks/binance-web3";
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
  // Warm the per-token cache with one batched call instead of one call per stock.
  if (binanceWeb3Configured())
    await rwaReferencePrices(
      symbols.flatMap((t) => MAINNET_ASSETS[t].variants.map((v) => v.address)),
    ).catch(() => undefined);
  const prices = await Promise.allSettled(
    symbols.map((ticker) => mainnetReferencePrice(ticker, forceRefresh)),
  );
  // One Market API call for the 24h change of every listed price; display only.
  const shown = prices.flatMap((p, i) => {
    if (p.status !== "fulfilled") return [];
    const v = MAINNET_ASSETS[symbols[i]].variants.find((x) => x.symbol === p.value.variant);
    return v ? [v.address] : [];
  });
  const change = binanceWeb3Configured()
    ? await marketChanges24h(shown).catch((error: unknown) => {
        console.warn("24h change unavailable", {
          code: error instanceof Error ? error.message : "unknown",
        });
        return new Map<string, number>();
      })
    : new Map<string, number>();
  const lines = prices.map((result, i) => {
    const ticker = symbols[i];
    if (result.status === "fulfilled") {
      const price = result.value;
      const status = price.cachedFallback
        ? "; saved price — refresh temporarily unavailable"
        : price.marketOpen
          ? ""
          : "; trading paused for this token";
      const v = MAINNET_ASSETS[ticker].variants.find((x) => x.symbol === price.variant);
      const move = formatChange24h(v && change.get(v.address));
      return `${MAINNET_ASSETS[ticker].name} (${ticker}): *≈ ${referenceDollars(price.value, price.decimals)} / token*${move ? ` ${move}` : ""}\nUpdated ${priceAge(price.asOf)}${status}`;
    }
    const error = result.reason;
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
  });
  return text(
    "📈 *Stock token prices · USD*\n\n" +
      lines.join("\n\n") +
      "\n\nBinance reference prices. Your final quote, including fees, appears before you confirm." +
      "\nReply ‘try again’ to refresh, or ‘all’ for every stock.",
  );
}

const usd = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const bigUsd = (n: number) =>
  n >= 1e12
    ? `$${(n / 1e12).toFixed(2)}T`
    : n >= 1e9
      ? `$${(n / 1e9).toFixed(2)}B`
      : `$${(n / 1e6).toFixed(2)}M`;

/** Company facts (Binance RWA Data) and the past week's trend (Binance Market). Display only. */
export async function stockProfileReply(symbol: MainnetStock) {
  const asset = MAINNET_ASSETS[symbol];
  if (!binanceWeb3Configured())
    return text(`Company details for ${asset.name} aren’t available right now.`);
  // xStocks are not covered by the keyed API; bStocks first, then Ondo.
  for (const variant of asset.variants.filter((v) => v.issuer !== "xStocks")) {
    try {
      const f = await companyFacts(variant.address);
      const lines = [`📊 *${asset.name} (${symbol})*`];
      const last = f.closes.at(-1);
      if (last !== undefined && f.weekOpen) {
        const pct = ((last - f.weekOpen) / f.weekOpen) * 100;
        lines.push(
          `Past 7 days: ${usd(f.weekOpen)} → ${usd(last)} (${pct >= 0 ? "+" : "−"}${Math.abs(pct).toFixed(2)}%)`,
          sparkline(f.closes),
        );
      }
      if (f.low52w !== undefined && f.high52w !== undefined)
        lines.push(`52-week range: ${usd(f.low52w)} – ${usd(f.high52w)}`);
      if (f.marketCap) lines.push(`Market cap: ${bigUsd(f.marketCap)}`);
      if (f.pe) lines.push(`P/E (TTM): ${f.pe.toFixed(1)}`);
      if (f.dividendYield !== undefined)
        lines.push(`Dividend yield: ${(f.dividendYield * 100).toFixed(2)}%`);
      if (lines.length === 1) continue;
      lines.push(
        "",
        `Data from Binance for ${variant.symbol}. Not investment advice. Ask for a price or say “Buy ${asset.name} with 5 USDT”.`,
      );
      return text(lines.join("\n"));
    } catch (error) {
      console.warn("Company facts unavailable", {
        symbol: variant.symbol,
        code: error instanceof Error ? error.message : "unknown",
      });
    }
  }
  return text(
    `Company details for ${asset.name} aren’t available right now. Please try again shortly.`,
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
