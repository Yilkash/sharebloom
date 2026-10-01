import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";

// Binance Web3 Wallet API (keyed). Requests are signed like the official connectors:
// base64(HMAC-SHA256(secret, timestamp + METHOD + "/build" + path + ["?" + query] + body)).
const BASE = "https://web3.binance.com/build";

export class BinanceWeb3Error extends Error {
  constructor(
    public readonly code: "not_configured" | "unavailable" | "rejected" | "invalid_response",
    public readonly status?: number,
    public readonly detail?: string,
  ) {
    super(code);
  }
}

/** An error carrying the HTTP status and Binance's own code and message (no credentials). */
export function web3Failure(r: Web3Response) {
  const b = (r.body ?? {}) as { code?: unknown; msg?: unknown };
  const detail =
    `${String(b.code ?? "")} ${typeof b.msg === "string" ? b.msg : typeof r.body === "string" ? r.body : ""}`
      .replace(/[^\x20-\x7e]/g, "")
      .trim()
      .slice(0, 160);
  return new BinanceWeb3Error(r.status === 200 ? "invalid_response" : "rejected", r.status, detail);
}

export const binanceWeb3Configured = () =>
  Boolean(process.env.BINANCE_WEB3_API_KEY?.trim() && process.env.BINANCE_WEB3_API_SECRET?.trim());

export function web3Signature(
  secret: string,
  timestamp: string,
  method: "GET" | "POST",
  path: string,
  query: string,
  body: string,
) {
  const preHash = `${timestamp}${method}/build${path}${query ? `?${query}` : ""}${body}`;
  return createHmac("sha256", secret).update(preHash).digest("base64");
}

// After a compliance block (40304, e.g. from a US server) or a rate-limit answer, stop calling
// for a while instead of retrying per stock; callers fall back to public data meanwhile.
const COMPLIANCE_PAUSE_MS = 10 * 60_000;
const RATE_LIMIT_PAUSE_MS = 5_000;
let pausedUntil = 0;
export const resetWeb3Pause = () => {
  pausedUntil = 0;
};

export type Web3Response = {
  status: number;
  ms: number;
  body: unknown;
  rateLimits: Record<string, string>;
};

/** One signed request. Returns the parsed body; never logs or returns credentials. */
export async function web3Request(
  method: "GET" | "POST",
  path: string,
  query: Record<string, string> = {},
  body?: unknown,
  timeoutMs = 8000,
): Promise<Web3Response> {
  const key = process.env.BINANCE_WEB3_API_KEY?.trim();
  const secret = process.env.BINANCE_WEB3_API_SECRET?.trim();
  if (!key || !secret) throw new BinanceWeb3Error("not_configured");
  if (Date.now() < pausedUntil) throw new BinanceWeb3Error("unavailable", undefined, "paused");
  const search = new URLSearchParams(query).toString();
  const bodyText = body === undefined ? "" : JSON.stringify(body);
  const timestamp = new Date().toISOString();
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}${search ? `?${search}` : ""}`, {
      method,
      headers: {
        "X-OC-APIKEY": key,
        "X-OC-TIMESTAMP": timestamp,
        "X-OC-SIGN": web3Signature(secret, timestamp, method, path, search, bodyText),
        "X-OC-RECV-WINDOW": "15000",
        "X-OC-NONCE": randomUUID(),
        ...(bodyText ? { "Content-Type": "application/json" } : {}),
      },
      body: bodyText || undefined,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
  } catch {
    throw new BinanceWeb3Error("unavailable");
  }
  const rateLimits: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    if (/^x-oc-(?!sign|apikey)/i.test(name) || /ratelimit|retry-after/i.test(name))
      rateLimits[name] = value;
  });
  const raw = await response.text();
  let parsed: unknown = raw;
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* Keep the text; callers validate the shape. */
  }
  const apiCode = (parsed as { code?: unknown } | null)?.code;
  if (apiCode === 40304) pausedUntil = Date.now() + COMPLIANCE_PAUSE_MS;
  else if (response.status === 429 || apiCode === 42900)
    pausedUntil = Math.max(pausedUntil, Date.now() + RATE_LIMIT_PAUSE_MS);
  return { status: response.status, ms: Date.now() - started, body: parsed, rateLimits };
}

// ---- RWA Data: per-token reference prices -------------------------------------------------

const decimal = z.string().regex(/^(?:0|[1-9]\d{0,19})(?:\.\d{1,60})?$/);
const priceRows = z.object({
  code: z.literal(0),
  data: z.array(
    z.object({
      binanceChainId: z.literal("56"),
      tokenContractAddress: z.string(),
      platformId: z.string().nullable(),
      referencePrice: decimal.nullable(),
      tokenPriceUpdatedAt: z.number().nullable().optional(),
    }),
  ),
});
export type KeyedReference = {
  reference: string;
  platform: string | null;
  updatedAt: number | null;
};

const PRICE_MS = 15_000;
// Cached per token, so one batched call (e.g. all 27 tokens for the price list) serves the
// later per-stock lookups without spending more of the rate limit (5).
const references = new Map<string, { at: number; value?: KeyedReference }>();
const pricePending = new Map<string, Promise<void>>();

/** Binance reference prices for a batch of tokens in one call, cached for 15 seconds. */
export async function rwaReferencePrices(addresses: readonly string[]) {
  const list = [...new Set(addresses.map((a) => a.toLowerCase()))].sort();
  const fresh = (a: string) => {
    const c = references.get(a);
    return c !== undefined && Date.now() - c.at < PRICE_MS;
  };
  if (!list.every(fresh)) {
    const key = list.join(",");
    let work = pricePending.get(key);
    if (!work) {
      work = (async () => {
        const r = await web3Request("GET", "/api/v1/dex/market/rwa/price", {
          binanceChainId: "56",
          tokenContractAddresses: key,
        });
        const parsed = priceRows.safeParse(r.body);
        if (r.status !== 200 || !parsed.success) throw web3Failure(r);
        const at = Date.now();
        const rows = new Map(
          parsed.data.data.map((row) => [row.tokenContractAddress.toLowerCase(), row]),
        );
        for (const address of list) {
          const row = rows.get(address);
          references.set(address, {
            at,
            value:
              row?.referencePrice && Number(row.referencePrice) > 0
                ? {
                    reference: row.referencePrice,
                    platform: row.platformId,
                    updatedAt: row.tokenPriceUpdatedAt ?? null,
                  }
                : undefined,
          });
        }
      })().finally(() => pricePending.delete(key));
      pricePending.set(key, work);
    }
    await work;
  }
  return new Map(
    list.flatMap((a) => {
      const value = references.get(a)?.value;
      return value ? [[a, value] as const] : [];
    }),
  );
}

// ---- Market: 24-hour price change ---------------------------------------------------------

const changeRows = z.object({
  code: z.literal(0),
  data: z.array(
    z.object({
      tokenContractAddress: z.string(),
      priceChange24H: z
        .string()
        .regex(/^-?\d{1,6}(?:\.\d{1,20})?$/)
        .nullable(),
    }),
  ),
});
const CHANGE_MS = 60_000;
let changes: { at: number; key: string; value: Map<string, number> } | undefined;

/**
 * 24-hour price change in percent for up to 100 tokens in one call. The body must be an
 * array of {binanceChainId, tokenContractAddress}; the official connectors send none, and an
 * object body returns a 50000 server error (see docs/DX_NOTES.md). Display only.
 */
export async function marketChanges24h(addresses: readonly string[]) {
  const list = [...new Set(addresses.map((a) => a.toLowerCase()))].sort();
  const key = list.join(",");
  if (changes && changes.key === key && Date.now() - changes.at < CHANGE_MS) return changes.value;
  const r = await web3Request(
    "POST",
    "/api/v1/dex/market/price-info",
    {},
    list.map((tokenContractAddress) => ({ binanceChainId: "56", tokenContractAddress })),
  );
  const parsed = changeRows.safeParse(r.body);
  if (r.status !== 200 || !parsed.success) throw web3Failure(r);
  const value = new Map<string, number>();
  for (const row of parsed.data.data)
    if (row.priceChange24H !== null)
      value.set(row.tokenContractAddress.toLowerCase(), Number(row.priceChange24H));
  changes = { at: Date.now(), key, value };
  return value;
}

/** "▲ 1.52% (24h)" for display, or an empty string when unknown. */
export function formatChange24h(percent: number | undefined) {
  if (percent === undefined || !Number.isFinite(percent)) return "";
  const arrow = percent > 0 ? "▲" : percent < 0 ? "▼" : "•";
  return `${arrow} ${Math.abs(percent).toFixed(2)}% (24h)`;
}

// ---- RWA Data + Market: company facts and the past week --------------------------------

const optionalDecimal = z
  .string()
  .regex(/^-?\d{1,20}(?:\.\d{1,30})?$/)
  .nullable()
  .optional();
const underlyingSchema = z.object({
  code: z.literal(0),
  data: z.object({
    marketData: z.object({
      high52W: optionalDecimal,
      low52W: optionalDecimal,
      marketCap: optionalDecimal,
      peRatioTTM: optionalDecimal,
      dividendYield: optionalDecimal,
    }),
  }),
});
const candleSchema = z.object({
  code: z.literal(0),
  data: z.array(z.array(z.number()).min(6)),
});
export type CompanyFacts = {
  high52w?: number;
  low52w?: number;
  marketCap?: number;
  pe?: number;
  dividendYield?: number;
  /** Daily closes, oldest first, and the first open of the period. */
  closes: number[];
  weekOpen?: number;
};
const facts = new Map<string, { at: number; value: CompanyFacts }>();
const num = (v: string | null | undefined) => (v == null ? undefined : Number(v));

/** Underlying-stock facts (RWA Data) and the last seven daily candles (Market). Display only. */
export async function companyFacts(address: string): Promise<CompanyFacts> {
  const key = address.toLowerCase();
  const saved = facts.get(key);
  if (saved && Date.now() - saved.at < 5 * 60_000) return saved.value;
  const query = { binanceChainId: "56", tokenContractAddress: key };
  const [market, candles] = await Promise.all([
    web3Request("GET", "/api/v1/dex/market/rwa/underlying-market", query),
    web3Request("GET", "/api/v1/dex/market/candles", { ...query, bar: "1d", limit: "7" }),
  ]);
  const m = underlyingSchema.safeParse(market.body);
  const c = candleSchema.safeParse(candles.body);
  if (!m.success && !c.success) throw web3Failure(m.success ? candles : market);
  // Candle: [open, high, low, close, volume, timestamp, count]; sort by time to be safe.
  const rows = c.success ? [...c.data.data].sort((a, b) => a[5] - b[5]) : [];
  const d = m.success ? m.data.data.marketData : undefined;
  const value: CompanyFacts = {
    high52w: num(d?.high52W),
    low52w: num(d?.low52W),
    marketCap: num(d?.marketCap),
    pe: num(d?.peRatioTTM),
    dividendYield: num(d?.dividendYield),
    closes: rows.map((r) => r[3]),
    weekOpen: rows[0]?.[0],
  };
  facts.set(key, { at: Date.now(), value });
  return value;
}

/** A one-line chart of closing prices, e.g. "▂▅▆▄▁▃▃". */
export function sparkline(values: readonly number[]) {
  if (values.length < 2) return "";
  const bars = "▁▂▃▄▅▆▇█";
  const lo = Math.min(...values);
  const span = Math.max(...values) - lo || 1;
  return values.map((v) => bars[Math.round(((v - lo) / span) * (bars.length - 1))]).join("");
}

/** Day-over-day direction of closing prices, e.g. "▼ ▲ ▼ ▼ ▲ ▼". Renders evenly in WhatsApp. */
export function dailyMoves(closes: readonly number[]) {
  return closes
    .slice(1)
    .map((close, i) => (close > closes[i] ? "▲" : close < closes[i] ? "▼" : "•"))
    .join(" ");
}

/** Safe fields for logs: our code, the HTTP status and Binance's code and message. */
export function web3ErrorLog(error: unknown) {
  return error instanceof BinanceWeb3Error
    ? { code: error.code, status: error.status ?? null, detail: error.detail ?? null }
    : { code: error instanceof Error ? error.message : "unknown" };
}

// ---- Trading: aggregated quote as an independent best-execution check ----------------------

const integer = z.string().regex(/^\d{1,78}$/);
const quoteSchema = z.object({
  code: z.literal(0),
  data: z
    .array(
      z.object({
        vendorName: z.string().max(60).nullable().optional(),
        fromTokenAmount: integer,
        toTokenAmount: integer,
        dexRouterList: z
          .array(z.object({ dexProtocol: z.object({ dexName: z.string().max(60) }).optional() }))
          .nullable()
          .optional(),
      }),
    )
    .min(1),
});
export type BinanceBenchmark = { vendor: string; dex?: string; amountOut: string };

/**
 * Binance's best aggregated quote for the same swap. Display only: Sharebloom still executes
 * the KyberSwap route it has verified, and shows how it compares.
 */
export async function aggregatedQuote(
  fromToken: string,
  toToken: string,
  amountIn: bigint,
  wallet: string,
): Promise<BinanceBenchmark> {
  // Stock tokens are quoted by RFQ, which requires the receiving wallet even though the
  // connectors mark it optional ("userWalletAddress is required for RFQ (Ondo) quote").
  const r = await web3Request("GET", "/api/v1/dex/aggregator/quote", {
    binanceChainId: "56",
    amount: amountIn.toString(),
    fromTokenAddress: fromToken,
    toTokenAddress: toToken,
    userWalletAddress: wallet,
  });
  const parsed = quoteSchema.safeParse(r.body);
  if (r.status !== 200 || !parsed.success) throw web3Failure(r);
  const valid = parsed.data.data.filter((q) => BigInt(q.fromTokenAmount) === amountIn);
  if (!valid.length) throw new BinanceWeb3Error("invalid_response", r.status, "amount mismatch");
  const best = valid.reduce((a, b) => (BigInt(b.toTokenAmount) > BigInt(a.toTokenAmount) ? b : a));
  return {
    vendor: best.vendorName || "Binance aggregator",
    dex: best.dexRouterList?.[0]?.dexProtocol?.dexName,
    amountOut: best.toTokenAmount,
  };
}

/** Our route's output against Binance's, in basis points (positive: we give the user more). */
export function benchmarkDeltaBps(ours: bigint, binance: bigint) {
  if (binance <= 0n) return 0n;
  return ((ours - binance) * 10_000n) / binance;
}

export function describeBenchmark(ours: bigint, b: BinanceBenchmark) {
  const delta = benchmarkDeltaBps(ours, BigInt(b.amountOut));
  if (delta >= -10n) return "✓ Matches or beats Binance’s best quote";
  return `Binance’s best quote gives ${(Number(-delta) / 100).toFixed(2)}% more (${b.vendor})`;
}
