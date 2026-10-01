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
const prices = new Map<string, { at: number; value: Map<string, KeyedReference> }>();
const pricePending = new Map<string, Promise<Map<string, KeyedReference>>>();

/** Binance reference prices for up to a few tokens in one call, cached for 15 seconds. */
export function rwaReferencePrices(addresses: readonly string[]) {
  const key = [...addresses]
    .map((a) => a.toLowerCase())
    .sort()
    .join(",");
  const saved = prices.get(key);
  if (saved && Date.now() - saved.at < PRICE_MS) return Promise.resolve(saved.value);
  let work = pricePending.get(key);
  if (!work) {
    work = (async () => {
      const r = await web3Request("GET", "/api/v1/dex/market/rwa/price", {
        binanceChainId: "56",
        tokenContractAddresses: key,
      });
      const parsed = priceRows.safeParse(r.body);
      if (r.status !== 200 || !parsed.success)
        throw new BinanceWeb3Error(r.status === 200 ? "invalid_response" : "rejected", r.status);
      const value = new Map<string, KeyedReference>();
      for (const row of parsed.data.data)
        if (row.referencePrice && Number(row.referencePrice) > 0)
          value.set(row.tokenContractAddress.toLowerCase(), {
            reference: row.referencePrice,
            platform: row.platformId,
            updatedAt: row.tokenPriceUpdatedAt ?? null,
          });
      prices.set(key, { at: Date.now(), value });
      return value;
    })().finally(() => pricePending.delete(key));
    pricePending.set(key, work);
  }
  return work;
}
