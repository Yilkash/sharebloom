import { KYBER_CHAIN_SLUG } from "../networks/chain";

export class TemporaryKyberError extends Error {}
// Waits between read-only attempts. A buy sends four route lookups in about a second, and
// shared outbound IPs (Railway Singapore) can hit KyberSwap's per-IP limit; back off rather
// than fail the review. Tests shorten these.
export const KYBER_RETRY_DELAYS_MS = [800, 2000];
const MAX_RETRY_AFTER_MS = 3000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function retryDelay(response: Response | undefined, attempt: number) {
  const header = Number(response?.headers.get("retry-after"));
  const fallback = KYBER_RETRY_DELAYS_MS[attempt] ?? 0;
  return Number.isFinite(header) && header > 0
    ? Math.min(header * 1000, MAX_RETRY_AFTER_MS)
    : fallback;
}

// GET quote requests only. Never use retries from this module for submission or signing.
export async function fetchMainnetRoute(query: URLSearchParams): Promise<Response> {
  const attempts = KYBER_RETRY_DELAYS_MS.length + 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const last = attempt === attempts - 1;
    let response: Response;
    try {
      response = await fetch(
        `https://aggregator-api.kyberswap.com/${KYBER_CHAIN_SLUG}/api/v1/routes?${query}`,
        {
          headers: { "x-client-id": "sharebloom" },
          signal: AbortSignal.timeout(12000),
          redirect: "error",
          cache: "no-store",
        },
      );
    } catch {
      console.warn("Mainnet route lookup failed", { reason: "network", attempt: attempt + 1 });
      if (last) throw new TemporaryKyberError("route_unavailable");
      await wait(retryDelay(undefined, attempt));
      continue;
    }
    if (response.ok) return response;
    const temporary = [429, 502, 503, 504].includes(response.status);
    console.warn("Mainnet route lookup failed", { status: response.status, attempt: attempt + 1 });
    await response.body?.cancel();
    if (!temporary) throw Error("route_unavailable");
    if (last) throw new TemporaryKyberError("route_busy");
    await wait(retryDelay(response, attempt));
  }
  throw Error("route_unavailable");
}
