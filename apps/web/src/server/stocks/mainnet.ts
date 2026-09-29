import {
  createPublicClient,
  erc20Abi,
  formatUnits,
  http,
  isAddress,
  parseUnits,
  type Address,
} from "viem";
import { z } from "zod";
import {
  MAINNET_ASSETS,
  MAINNET_CHAIN_ID,
  MAINNET_QUOTE,
  MAINNET_STOCK_TOKENS,
  mainnetChain,
  type MainnetStock,
  type StockVariant,
} from "../networks/chain";
import { rwaTokenList, rwaTokenQuote } from "./binance-rwa";
import { fetchMainnetRoute } from "./kyber-route";
import { pickBestVariant, type VariantEvaluation } from "./stock-routing";

export class MainnetReadError extends Error {
  constructor(
    public code:
      | "rpc_unavailable"
      | "registry_unavailable"
      | "registry_changed"
      | "quote_not_configured"
      | "quote_unavailable"
      | "quote_busy"
      | "token_not_authorized"
      | "no_liquidity"
      | "no_fair_price"
      | "invalid_amount"
      | "invalid_response",
  ) {
    super(code);
  }
}
const client = createPublicClient({
  chain: mainnetChain,
  transport: http(mainnetChain.rpcUrls.default.http[0], {
    timeout: 10000,
    retryCount: 1,
    retryDelay: 300,
  }),
});

let registryPending: Promise<typeof MAINNET_ASSETS> | undefined;
/** Every configured stock variant must be listed by Binance on chain 56 with the same address and decimals. */
export function verifiedMainnetRegistry() {
  if (!registryPending)
    registryPending = readMainnetRegistry().finally(() => {
      registryPending = undefined;
    });
  return registryPending;
}
async function readMainnetRegistry() {
  let rows;
  try {
    rows = await rwaTokenList();
  } catch {
    throw new MainnetReadError("registry_unavailable");
  }
  for (const token of MAINNET_STOCK_TOKENS) {
    const matches = rows.filter(
      (r) =>
        r.chainId === String(MAINNET_CHAIN_ID) &&
        r.contractAddress.toLowerCase() === token.address.toLowerCase(),
    );
    if (
      matches.length !== 1 ||
      matches[0].ticker !== token.ticker ||
      matches[0].symbol !== token.symbol ||
      matches[0].d !== token.decimals
    )
      throw new MainnetReadError("registry_changed");
  }
  return MAINNET_ASSETS;
}
let snapshotPending: ReturnType<typeof readMainnetSnapshot> | undefined;
function mainnetSnapshot() {
  if (!snapshotPending)
    snapshotPending = readMainnetSnapshot().finally(() => {
      snapshotPending = undefined;
    });
  return snapshotPending;
}
async function readMainnetSnapshot() {
  try {
    const [chainId, block] = await Promise.all([client.getChainId(), client.getBlock()]);
    const age = Date.now() - Number(block.timestamp) * 1000;
    if (chainId !== MAINNET_CHAIN_ID || age > 120000 || age < -30000) throw Error("stale_mainnet");
    return block;
  } catch {
    throw new MainnetReadError("rpc_unavailable");
  }
}
export async function mainnetPortfolio(wallet: Address) {
  if (!isAddress(wallet)) throw new MainnetReadError("invalid_response");
  await verifiedMainnetRegistry();
  const block = await mainnetSnapshot();
  const tokens = [
    ...MAINNET_STOCK_TOKENS,
    { ticker: undefined, issuer: undefined, ...MAINNET_QUOTE },
  ];
  const balances = await Promise.all(
    tokens.map(async (token) => {
      const [code, decimals, symbol, balance] = await Promise.all([
        client.getCode({ address: token.address, blockNumber: block.number }),
        client.readContract({
          address: token.address,
          abi: erc20Abi,
          functionName: "decimals",
          blockNumber: block.number,
        }),
        client.readContract({
          address: token.address,
          abi: erc20Abi,
          functionName: "symbol",
          blockNumber: block.number,
        }),
        client.readContract({
          address: token.address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [wallet],
          blockNumber: block.number,
        }),
      ]);
      if (!code || code === "0x" || decimals !== token.decimals || symbol !== token.symbol)
        throw new MainnetReadError("registry_changed");
      return {
        symbol,
        ticker: token.ticker,
        issuer: token.issuer,
        address: token.address,
        decimals,
        balance,
        formatted: formatUnits(balance, decimals),
      };
    }),
  );
  const native = await client.getBalance({ address: wallet, blockNumber: block.number });
  return { chainId: MAINNET_CHAIN_ID, wallet, block, balances, native };
}
const integer = z.string().regex(/^\d{1,78}$/);
const routeSchema = z.object({
  code: z.literal(0),
  data: z.object({
    routeSummary: z.object({
      tokenIn: z.string(),
      tokenOut: z.string(),
      amountIn: integer,
      amountOut: integer,
      timestamp: z.number().int().positive(),
    }),
  }),
});
/** Read-only Kyber route for one token pair; no wallet or calldata involved. */
export async function previewRoute(tokenIn: Address, tokenOut: Address, amountIn: bigint) {
  let body: unknown;
  try {
    const response = await fetchMainnetRoute(
      new URLSearchParams({ tokenIn, tokenOut, amountIn: amountIn.toString() }),
    );
    body = await response.json();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    throw new MainnetReadError(message === "route_busy" ? "quote_busy" : "quote_unavailable");
  }
  const parsed = routeSchema.safeParse(body);
  if (!parsed.success) throw new MainnetReadError("invalid_response");
  const route = parsed.data.data.routeSummary;
  const age = Date.now() - route.timestamp * 1000;
  if (
    age > 120000 ||
    age < -30000 ||
    route.tokenIn.toLowerCase() !== tokenIn.toLowerCase() ||
    route.tokenOut.toLowerCase() !== tokenOut.toLowerCase() ||
    BigInt(route.amountIn) !== amountIn
  )
    throw new MainnetReadError("invalid_response");
  if (BigInt(route.amountOut) <= 0n) throw new MainnetReadError("no_liquidity");
  return { amountOut: BigInt(route.amountOut), timestamp: route.timestamp };
}
/**
 * Pick the fairest issuer for a ticker using read-only routes. Buys compare all variants;
 * sells compare the given candidates (the variants the wallet holds, or all for a preview).
 */
export async function bestMainnetVariant(
  symbol: MainnetStock,
  side: "buy" | "sell",
  amountIn: bigint,
  candidates: readonly StockVariant[] = MAINNET_ASSETS[symbol].variants,
) {
  return pickBestVariant(
    symbol,
    side,
    candidates,
    async (v) => {
      const [tokenIn, tokenOut] =
        side === "buy" ? [MAINNET_QUOTE.address, v.address] : [v.address, MAINNET_QUOTE.address];
      const route = await previewRoute(tokenIn, tokenOut, amountIn);
      return { amountIn, amountOut: route.amountOut };
    },
    (v) => rwaTokenQuote(v.address),
  );
}
// Indicative price only. Never accept or expose API-provided signing calldata.
export async function mainnetPrice(symbol: MainnetStock, side: "buy" | "sell", amount: string) {
  const sellDecimals = side === "buy" ? MAINNET_QUOTE.decimals : 18;
  if (!/^(?:0|[1-9]\d{0,3})(?:\.\d{1,18})?$/.test(amount))
    throw new MainnetReadError("invalid_amount");
  const sellAmount = parseUnits(amount, sellDecimals);
  if (sellAmount <= 0n || sellAmount > parseUnits("1000", sellDecimals))
    throw new MainnetReadError("invalid_amount");
  await verifiedMainnetRegistry();
  const block = await mainnetSnapshot();
  const { chosen, evaluations } = await bestMainnetVariant(symbol, side, sellAmount);
  if (!chosen) {
    const anyRoute = evaluations.some((e: VariantEvaluation) => e.outcome === "unfair_price");
    throw new MainnetReadError(anyRoute ? "no_fair_price" : "no_liquidity");
  }
  return {
    chainId: MAINNET_CHAIN_ID,
    symbol,
    side,
    variant: chosen,
    evaluations,
    sellAmount,
    buyAmount: chosen.quote.amountOut,
    sellDecimals,
    buyDecimals: side === "buy" ? 18 : MAINNET_QUOTE.decimals,
    blockNumber: block.number,
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
    networkFeeUsd: null,
    provider: "KyberSwap" as const,
    executionEnabled: false as const,
  };
}
