import { z } from "zod";

// Binance Web3 RWA data (public, no API key). Documented in binance/binance-skills-hub
// skills/binance-web3/binance-tokenized-securities-info. Used for the verified token list,
// per-token reference prices and trading status. Some ISPs (e.g. in Nigeria) block Binance
// domains at DNS level; the hosted service is unaffected.
const BASE = "https://www.binance.com/bapi/defi";
const HEADERS = { "Accept-Encoding": "identity", "User-Agent": "binance-web3/1.1 (Skill)" };
const LIST_MS = 60 * 60_000;
const DYNAMIC_MS = 15_000;

export class BinanceRwaError extends Error {
  constructor(
    public readonly code: "source_unavailable" | "provider_busy" | "invalid_data" | "not_listed",
  ) {
    super(code);
  }
}
const envelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ code: z.literal("000000"), success: z.literal(true), data });

async function getJson(path: string): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(BASE + path, {
        headers: HEADERS,
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      });
      if (response.status === 429 || response.status === 503)
        throw new BinanceRwaError("provider_busy");
      if (!response.ok) throw new BinanceRwaError("source_unavailable");
      return await response.json();
    } catch (error) {
      const code = error instanceof BinanceRwaError ? error.code : "source_unavailable";
      if (attempt === 1 || !["source_unavailable", "provider_busy"].includes(code))
        throw error instanceof BinanceRwaError ? error : new BinanceRwaError(code);
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  throw new BinanceRwaError("source_unavailable");
}

const listRow = z.object({
  chainId: z.string(),
  contractAddress: z.string(),
  symbol: z.string(),
  ticker: z.string(),
  type: z.number().optional(),
  d: z.number(),
});
export type RwaListRow = z.infer<typeof listRow>;
let list: { rows: RwaListRow[]; expires: number } | undefined;
let listPending: Promise<RwaListRow[]> | undefined;

export function rwaTokenList(): Promise<RwaListRow[]> {
  if (list && list.expires > Date.now()) return Promise.resolve(list.rows);
  listPending ??= (async () => {
    const body = await getJson(
      "/v1/public/wallet-direct/buw/wallet/market/token/rwa/stock/detail/list/ai",
    );
    const parsed = envelope(z.array(z.unknown())).safeParse(body);
    if (!parsed.success) throw new BinanceRwaError("invalid_data");
    // Skip malformed rows individually; required tokens are checked by the caller.
    const rows = parsed.data.data.flatMap((row) => {
      const r = listRow.safeParse(row);
      return r.success ? [r.data] : [];
    });
    if (!rows.length) throw new BinanceRwaError("invalid_data");
    list = { rows, expires: Date.now() + LIST_MS };
    return rows;
  })().finally(() => {
    listPending = undefined;
  });
  return listPending;
}

const decimal = z.string().regex(/^(?:0|[1-9]\d{0,19})(?:\.\d{1,60})?$/);
const dynamicSchema = envelope(
  z.object({
    symbol: z.string(),
    ticker: z.string(),
    tokenInfo: z.object({ price: decimal }).passthrough(),
    statusInfo: z
      .object({
        openState: z.boolean(),
        reasonCode: z.string().nullable().optional(),
        marketStatus: z.string().nullable().optional(),
      })
      .passthrough(),
  }),
);
export type RwaQuote = {
  symbol: string;
  ticker: string;
  /** Per-token USD price as an 18-decimal fixed-point integer. */
  price: bigint;
  open: boolean;
  reason: string | null;
  marketStatus: string | null;
  readAt: number;
};
const dynamic = new Map<string, RwaQuote>();
const dynamicPending = new Map<string, Promise<RwaQuote>>();

/** Parse a decimal string to an 18-decimal integer, truncating extra precision. */
export function toFixed18(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole + fraction.slice(0, 18).padEnd(18, "0"));
}

export function rwaTokenQuote(address: string): Promise<RwaQuote> {
  const key = address.toLowerCase();
  const saved = dynamic.get(key);
  if (saved && Date.now() - saved.readAt < DYNAMIC_MS) return Promise.resolve(saved);
  let work = dynamicPending.get(key);
  if (!work) {
    work = (async () => {
      const body = await getJson(
        `/v2/public/wallet-direct/buw/wallet/market/token/rwa/dynamic/ai?chainId=56&contractAddress=${key}`,
      );
      const parsed = dynamicSchema.safeParse(body);
      if (!parsed.success) throw new BinanceRwaError("invalid_data");
      const d = parsed.data.data;
      const price = toFixed18(d.tokenInfo.price);
      if (price <= 0n) throw new BinanceRwaError("invalid_data");
      const quote: RwaQuote = {
        symbol: d.symbol,
        ticker: d.ticker,
        price,
        open: d.statusInfo.openState,
        reason: d.statusInfo.reasonCode ?? null,
        marketStatus: d.statusInfo.marketStatus ?? null,
        readAt: Date.now(),
      };
      dynamic.set(key, quote);
      return quote;
    })().finally(() => {
      dynamicPending.delete(key);
    });
    dynamicPending.set(key, work);
  }
  return work;
}
