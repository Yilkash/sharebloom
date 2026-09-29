import { KYBER_CHAIN_SLUG } from "../networks/chain";

export class TemporaryKyberError extends Error {}
// GET quote requests only. Never use retries from this module for submission or signing.
export async function fetchMainnetRoute(query: URLSearchParams): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
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
      if (attempt === 1) throw new TemporaryKyberError("route_unavailable");
      await new Promise((resolve) => setTimeout(resolve, 600));
      continue;
    }
    if (response.ok) return response;
    const temporary = [429, 502, 503, 504].includes(response.status);
    console.warn("Mainnet route lookup failed", { status: response.status, attempt: attempt + 1 });
    await response.body?.cancel();
    if (!temporary) throw Error("route_unavailable");
    if (attempt === 1) throw new TemporaryKyberError("route_busy");
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  throw Error("route_unavailable");
}
