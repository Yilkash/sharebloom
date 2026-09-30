import { MAINNET_STOCK_SYMBOLS, type MainnetStock } from "../networks/chain";

// Explicit supported aliases only; never fuzzy-match an unknown company for a trade.
// Common misspellings are listed by hand, and every review shows the company name.
const names: Record<MainnetStock, string[]> = {
  AAPL: ["apple", "appl", "aple", "appel"],
  NVDA: ["nvidia", "nvdia", "nvida", "nvidea"],
  TSLA: ["tesla", "telsa", "tesler"],
  MSFT: ["microsoft", "microsft", "mircosoft", "micosoft"],
  GOOGL: ["alphabet", "google", "goog"],
  AMZN: ["amazon", "amazn", "amazone"],
  META: ["meta", "facebook", "fb"],
  SPY: ["s&p 500", "s&p500", "s&p", "sp500", "snp 500", "snp500"],
  QQQ: ["nasdaq-100", "nasdaq 100", "nasdaq100", "nasdaq"],
};
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s*");
const alternation = (symbol: MainnetStock) =>
  [symbol, ...names[symbol].map((n) => escape(n) + "(?:['’]s|s)?")].join("|");
const aliases = Object.fromEntries(
  MAINNET_STOCK_SYMBOLS.map((symbol) => [
    symbol,
    new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternation(symbol)})(?![\\p{L}\\p{N}])`, "iu"),
  ]),
) as Record<MainnetStock, RegExp>;

// Any supported ticker or company name, for parsing quantities like "0.5 Microsoft".
export const MAINNET_STOCK_ALIAS_PATTERN = MAINNET_STOCK_SYMBOLS.map(alternation).join("|");

export function mainnetStockMentions(input: string): MainnetStock[] {
  const normalized = input.normalize("NFKC");
  return MAINNET_STOCK_SYMBOLS.filter((symbol) => aliases[symbol].test(normalized));
}

// Map a unit such as "Microsoft" or "msft" to its ticker when it names exactly that stock.
export function mainnetStockForUnit(unit: string | undefined): MainnetStock | undefined {
  if (!unit) return undefined;
  const whole = unit.normalize("NFKC").trim();
  const [match, ...rest] = mainnetStockMentions(whole);
  if (!match || rest.length) return undefined;
  const exact = new RegExp(`^(?:${alternation(match)})$`, "iu");
  return exact.test(whole) ? match : undefined;
}
