import { createHmac, randomUUID } from "node:crypto";

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
