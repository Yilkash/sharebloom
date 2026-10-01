import { prepareMainnetQuote } from "./mainnet-quote";
import { randomUUID } from "node:crypto";
import {
  createPublicClient,
  http,
  parseAbi,
  erc20Abi,
  encodeFunctionData,
  decodeFunctionData,
  getAddress,
  decodeAbiParameters,
  encodeAbiParameters,
  parseAbiParameters,
  zeroAddress,
  isAddress,
  keccak256,
  toBytes,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import {
  MAINNET_ASSETS,
  MAINNET_CHAIN_ID,
  MAINNET_QUOTE,
  MAINNET_STOCK_TOKENS,
  mainnetChain,
  stockVariantByAddress,
  type MainnetStock,
  type StockIssuer,
  type StockVariant,
} from "../networks/chain";
import { bestMainnetVariant, verifiedMainnetRegistry } from "./mainnet";
import { rwaTokenQuote } from "./binance-rwa";
import {
  aggregatedQuote,
  binanceWeb3Configured,
  web3ErrorLog,
  type BinanceBenchmark,
} from "./binance-web3";
import { describeEvaluation, MAX_DEVIATION_BPS, priceDeviationBps } from "./stock-routing";

export const mainnetRpc = createPublicClient({
  chain: mainnetChain,
  transport: http(mainnetChain.rpcUrls.default.http[0], {
    timeout: 10000,
    retryCount: 1,
    retryDelay: 300,
  }),
});
export const KYBER_ROUTER = "0x6131B5fae19EA4f9D964eAc0408E4408b66337b5" as const;
// ABI published with KyberSwap MetaAggregationRouterV2. Only the explicitly
// validated outer swap terms are required for simple and provider-trusted packed routes.
export const mainnetRouterAbi = parseAbi([
  "struct SwapDescription { address srcToken; address dstToken; address[] srcReceivers; uint256[] srcAmounts; address[] feeReceivers; uint256[] feeAmounts; address dstReceiver; uint256 amount; uint256 minReturnAmount; uint256 flags; bytes permit; }",
  "struct SwapExecution { address callTarget; address approveTarget; bytes targetData; SwapDescription desc; bytes clientData; }",
  "function swap(SwapExecution execution) payable returns (uint256 returnAmount, uint256 gasUsed)",
  "event Swapped(address sender,address srcToken,address dstToken,address dstReceiver,uint256 spentAmount,uint256 returnAmount)",
]);
export const simpleSwapParameters = parseAbiParameters(
  "(address[] firstPools,uint256[] firstSwapAmounts,bytes[] swapDatas,uint256 deadline,bytes positiveSlippageData) data",
);
export function requireTrade(ok: unknown, code = "mainnet_validation_failed"): asserts ok {
  if (!ok) throw Error(code);
}
// The user confirms a maximum network fee per step (reviewed gas x reviewed price
// ceiling), not a gas-unit count. Provider swap-gas figures can run low, so a
// higher fresh estimate is accepted when, with a 10% margin, it still fits the
// confirmed fee at the price actually used. Returns null when it does not fit.
export function executionGasLimit(
  estimate: bigint,
  reviewedGas: bigint,
  reviewedPrice: bigint,
  actualPrice: bigint,
): bigint | null {
  if (estimate <= 0n || actualPrice <= 0n || actualPrice > reviewedPrice) return null;
  if (estimate <= reviewedGas) return reviewedGas;
  const limit = (estimate * 110n + 99n) / 100n;
  return limit * actualPrice <= reviewedGas * reviewedPrice ? limit : null;
}
// Gas price to broadcast with. The base fee can tick up between reading it and inclusion,
// and a bid below the new base fee is rejected ("max fee per gas less than block base
// fee"), so bid 5% above the current price. Never exceed the price ceiling the user
// confirmed. BNB Chain charges the bid itself (a few hundredths of a cent here); the
// gas-limit check bounds the worst case by the confirmed fee at this bid.
export function broadcastGasPrice(suggested: bigint, baseFee: bigint, ceiling: bigint) {
  const current = suggested > baseFee ? suggested : baseFee;
  const bid = (current * 105n + 99n) / 100n;
  return bid < ceiling ? bid : ceiling;
}
export const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
export function mainnetTradeConfig() {
  const executor = process.env.MAINNET_KYBER_EXECUTOR?.trim();
  const executorHash = process.env.MAINNET_KYBER_EXECUTOR_CODEHASH?.trim();
  const routerHash = process.env.MAINNET_ROUTER_CODEHASH?.trim();
  const policy = process.env.PRIVY_MAINNET_POLICY_ID?.trim();
  const maxInput = process.env.MAINNET_MAX_USDT_PER_TRADE?.trim();
  const maxFees = process.env.MAINNET_MAX_FEE_WEI?.trim();
  requireTrade(
    executor &&
      isAddress(executor) &&
      executorHash &&
      /^0x[a-fA-F0-9]{64}$/.test(executorHash) &&
      routerHash &&
      /^0x[a-fA-F0-9]{64}$/.test(routerHash) &&
      policy,
    "mainnet_setup_required",
  );
  requireTrade(maxInput && /^\d+(\.\d{1,6})?$/.test(maxInput), "mainnet_limits_required");
  requireTrade(!maxFees || /^[1-9]\d{0,18}$/.test(maxFees), "mainnet_fee_limit_invalid");
  const inputCap = parseUnits(maxInput, MAINNET_QUOTE.decimals),
    feeCap = maxFees ? BigInt(maxFees) : undefined;
  requireTrade(
    inputCap > 0n &&
      inputCap <= parseUnits("1000", MAINNET_QUOTE.decimals) &&
      (feeCap === undefined || feeCap <= 1000000000000000n),
    "mainnet_limits_invalid",
  );
  return { executor: getAddress(executor), executorHash, routerHash, policy, inputCap, feeCap };
}
export async function checkMainnetRouter() {
  const c = mainnetTradeConfig();
  requireTrade((await mainnetRpc.getChainId()) === MAINNET_CHAIN_ID);
  const block = await mainnetRpc.getBlock();
  requireTrade(Math.abs(Date.now() - Number(block.timestamp) * 1000) < 120000);
  const [executorCode, routerCode] = await Promise.all([
    mainnetRpc.getCode({ address: c.executor }),
    mainnetRpc.getCode({ address: KYBER_ROUTER }),
  ]);
  requireTrade(executorCode && executorCode !== "0x" && routerCode && routerCode !== "0x");
  requireTrade(
    keccak256(executorCode) === c.executorHash && keccak256(routerCode) === c.routerHash,
    "mainnet_router_code_changed",
  );
  return c;
}
export type MainnetPlan = {
  provider?: "kyber";
  // The stock token actually traded (one of the ticker's issuer variants) and why it won.
  variant?: { symbol: string; issuer: StockIssuer };
  routing?: string[];
  // Binance Web3 aggregated quote for the same swap, for display only; never signed.
  benchmark?: BinanceBenchmark;
  id: string;
  orderId: Hex;
  wallet: Address;
  router: Address;
  symbol: MainnetStock | typeof MAINNET_QUOTE.symbol;
  transferTo?: Address;
  side: "buy" | "sell" | "send";
  inputToken: Address;
  outputToken: Address;
  amountIn: string;
  expectedOutput: string;
  minimumOutput: string;
  estimatedFee?: string;
  deadline: number;
  steps: {
    kind: "reset" | "approve" | "trade" | "transfer";
    to: Address;
    data: Hex;
    gas: string;
    gasPrice: string;
  }[];
};
// Decode provider calldata before approval. No application contract is deployed.
export async function prepareMainnetPlan(
  wallet: Address,
  symbol: MainnetStock,
  side: "buy" | "sell",
  amount: string,
): Promise<MainnetPlan> {
  requireTrade(isAddress(wallet) && symbol in MAINNET_ASSETS && ["buy", "sell"].includes(side));
  const c = await checkMainnetRouter();
  await verifiedMainnetRegistry();
  // BSC USDT and every stock variant use 18 decimals, so one parse covers both sides.
  requireTrade(
    MAINNET_QUOTE.decimals === 18 &&
      MAINNET_ASSETS[symbol].variants.every((v) => v.decimals === 18),
  );
  requireTrade(/^(?:0|[1-9]\d{0,3})(?:\.\d{1,18})?$/.test(amount), "invalid_amount");
  const amountIn = parseUnits(amount, 18);
  requireTrade(amountIn > 0n && amountIn <= parseUnits("1000", 18), "invalid_amount");
  if (side === "buy") requireTrade(amountIn <= c.inputCap, "trade_limit_exceeded");
  // A buy may use any issuer; a sell only the variants this wallet holds enough of.
  let candidates: readonly StockVariant[] = MAINNET_ASSETS[symbol].variants;
  if (side === "sell") {
    const held = await Promise.all(
      candidates.map((v) =>
        mainnetRpc.readContract({
          address: v.address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [wallet],
        }),
      ),
    );
    candidates = candidates.filter((_, i) => held[i] >= amountIn);
    requireTrade(candidates.length > 0, "insufficient_tokens");
  }
  const best = await bestMainnetVariant(symbol, side, amountIn, candidates);
  requireTrade(best.chosen, "no_fair_price");
  const stock = best.chosen;
  const input = side === "buy" ? MAINNET_QUOTE : stock,
    output = side === "buy" ? stock : MAINNET_QUOTE;
  const quote = await prepareMainnetQuote({
    wallet,
    inputToken: input.address,
    outputToken: output.address,
    amountIn: amountIn.toString(),
  });
  const expected = BigInt(quote.expectedOutput),
    minimum = BigInt(quote.minimumOutput),
    deadline = quote.deadline;
  // Prices can move between the comparison and the built route: re-check the exact route.
  const reference = await rwaTokenQuote(stock.address);
  requireTrade(reference.open, "stock_not_trading");
  requireTrade(
    priceDeviationBps(side, amountIn, expected, reference.price) <= MAX_DEVIATION_BPS,
    "no_fair_price",
  );
  requireTrade(minimum > 0n && (side !== "sell" || expected <= c.inputCap));
  const benchmarkWork = binanceWeb3Configured()
    ? aggregatedQuote(input.address, output.address, amountIn).catch((error: unknown) => {
        console.warn("Binance benchmark quote unavailable", web3ErrorLog(error));
        return undefined;
      })
    : Promise.resolve(undefined);
  const [balance, eth, allowance, suggestedPrice, decimals, block] = await Promise.all([
    mainnetRpc.readContract({
      address: input.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [wallet],
    }),
    mainnetRpc.getBalance({ address: wallet }),
    mainnetRpc.readContract({
      address: input.address,
      abi: erc20Abi,
      functionName: "allowance",
      args: [wallet, quote.router],
    }),
    mainnetRpc.getGasPrice(),
    mainnetRpc.readContract({ address: input.address, abi: erc20Abi, functionName: "decimals" }),
    mainnetRpc.getBlock(),
  ]);
  requireTrade(decimals === input.decimals && balance >= amountIn, "insufficient_tokens");
  const id = randomUUID(),
    orderId = keccak256(toBytes(`steward-mainnet-v1:${wallet.toLowerCase()}:${id}`));
  const steps: MainnetPlan["steps"] = [];
  requireTrade(
    typeof block.baseFeePerGas === "bigint" && block.baseFeePerGas >= 0n && suggestedPrice > 0n,
    "gas_price_unavailable",
  );
  const gasPrice = suggestedPrice > block.baseFeePerGas ? suggestedPrice : block.baseFeePerGas;
  // Reserve a modest fee allowance in the review; the runner uses the current
  // suggested price within this ceiling, rather than always charging the ceiling.
  const price = (gasPrice * 125n + 99n) / 100n;
  let estimatedFee = 0n;
  const gasLimit = (estimate: bigint) => (estimate * 125n + 99n) / 100n;
  // Estimate approvals from the actual wallet. The swap estimate comes from
  // the selected provider because its approval has not been submitted yet. The runner simulates
  // every step immediately before sending, and never raises the reviewed limits.
  const approval = async (value: bigint, kind: "reset" | "approve") => {
    const data = encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [quote.router, value],
    });
    let estimate = await mainnetRpc.estimateGas({
      account: wallet,
      to: input.address,
      data,
      value: 0n,
    });
    // A subsequent zero-to-nonzero allowance write can cost more than this
    // simulation against the current nonzero allowance. Reserve conservatively.
    if (kind === "approve" && allowance > 0n && estimate < 100000n) estimate = 100000n;
    requireTrade(estimate > 0n && estimate <= 200000n, "approval_gas_unavailable");
    estimatedFee += estimate * gasPrice;
    steps.push({
      kind,
      to: input.address,
      data,
      gas: gasLimit(estimate).toString(),
      gasPrice: price.toString(),
    });
  };
  if (allowance > 0n) await approval(0n, "reset");
  await approval(amountIn, "approve");
  const swapGas = BigInt(quote.swapGas);
  requireTrade(swapGas > 0n && swapGas <= 2000000n, "swap_gas_unavailable");
  estimatedFee += swapGas * gasPrice;
  steps.push({
    kind: "trade",
    to: quote.router,
    data: quote.data,
    gas: gasLimit(swapGas).toString(),
    gasPrice: price.toString(),
  });
  const fee = steps.reduce((sum, step) => sum + BigInt(step.gas) * BigInt(step.gasPrice), 0n);
  requireTrade(c.feeCap === undefined || fee <= c.feeCap, "operator_fee_limit_exceeded");
  requireTrade(eth >= fee, "insufficient_eth_for_network_fee");
  const plan = {
    id,
    orderId,
    wallet,
    router: quote.router,
    provider: quote.provider,
    variant: { symbol: stock.symbol, issuer: stock.issuer },
    routing: best.evaluations.map((e) => describeEvaluation(e, side)),
    benchmark: await benchmarkWork,
    symbol,
    side,
    inputToken: input.address,
    outputToken: output.address,
    amountIn: amountIn.toString(),
    expectedOutput: expected.toString(),
    minimumOutput: minimum.toString(),
    estimatedFee: estimatedFee.toString(),
    deadline,
    steps,
  };
  validateMainnetPlan(plan);
  return plan;
}
export async function prepareMainnetTransfer(
  wallet: Address,
  recipient: Address,
  amount: string,
): Promise<MainnetPlan> {
  await checkMainnetRouter();
  requireTrade(/^(?:0|[1-9]\d{0,3})(?:\.\d{1,6})?$/.test(amount), "invalid_amount");
  const amountIn = parseUnits(amount, MAINNET_QUOTE.decimals);
  requireTrade(
    amountIn > 0n && amountIn <= parseUnits("1000", MAINNET_QUOTE.decimals),
    "invalid_amount",
  );
  const data = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [recipient, amountIn],
  });
  const [balance, eth, suggestedPrice, decimals, simulated, block] = await Promise.all([
    mainnetRpc.readContract({
      address: MAINNET_QUOTE.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [wallet],
    }),
    mainnetRpc.getBalance({ address: wallet }),
    mainnetRpc.getGasPrice(),
    mainnetRpc.readContract({
      address: MAINNET_QUOTE.address,
      abi: erc20Abi,
      functionName: "decimals",
    }),
    mainnetRpc.simulateContract({
      account: wallet,
      address: MAINNET_QUOTE.address,
      abi: erc20Abi,
      functionName: "transfer",
      args: [recipient, amountIn],
    }),
    mainnetRpc.getBlock(),
  ]);
  requireTrade(balance >= amountIn, "insufficient_tokens");
  requireTrade(decimals === MAINNET_QUOTE.decimals && simulated.result === true);
  const gas = await mainnetRpc.estimateGas({
    account: wallet,
    to: MAINNET_QUOTE.address,
    data,
    value: 0n,
  });
  requireTrade(
    typeof block.baseFeePerGas === "bigint" && block.baseFeePerGas >= 0n && suggestedPrice > 0n,
    "gas_price_unavailable",
  );
  const price = suggestedPrice > block.baseFeePerGas ? suggestedPrice : block.baseFeePerGas;
  requireTrade(gas > 0n && gas <= 200000n);
  const gasLimit = (gas * 125n + 99n) / 100n,
    ceiling = (price * 125n + 99n) / 100n;
  requireTrade(eth >= gasLimit * ceiling, "insufficient_eth_for_network_fee");
  const id = randomUUID();
  const plan: MainnetPlan = {
    id,
    orderId: keccak256(toBytes(`steward-mainnet-v1:${wallet.toLowerCase()}:${id}`)),
    wallet,
    router: KYBER_ROUTER,
    symbol: MAINNET_QUOTE.symbol,
    side: "send",
    transferTo: recipient,
    inputToken: MAINNET_QUOTE.address,
    outputToken: MAINNET_QUOTE.address,
    amountIn: amountIn.toString(),
    expectedOutput: amountIn.toString(),
    minimumOutput: amountIn.toString(),
    estimatedFee: (gas * price).toString(),
    deadline: Math.floor(Date.now() / 1000) + 240,
    steps: [
      {
        kind: "transfer",
        to: MAINNET_QUOTE.address,
        data,
        gas: gasLimit.toString(),
        gasPrice: ceiling.toString(),
      },
    ],
  };
  validateMainnetPlan(plan);
  return plan;
}
export function validateMainnetPlan(p: MainnetPlan) {
  requireTrade(p.provider === undefined || p.provider === "kyber");
  if (p.side === "send") {
    const c = mainnetTradeConfig(),
      recipient = p.transferTo;
    requireTrade(
      p.symbol === MAINNET_QUOTE.symbol && isAddress(p.wallet) && recipient && isAddress(recipient),
    );
    requireTrade(
      ![
        zeroAddress,
        p.wallet,
        MAINNET_QUOTE.address,
        KYBER_ROUTER,
        ...MAINNET_STOCK_TOKENS.map((a) => a.address),
      ].some((a) => sameAddress(a, recipient)),
    );
    requireTrade(
      /^[a-f0-9-]{36}$/.test(p.id) &&
        p.orderId === keccak256(toBytes(`steward-mainnet-v1:${p.wallet.toLowerCase()}:${p.id}`)),
    );
    requireTrade(Number.isSafeInteger(p.deadline) && p.deadline > 0 && p.steps.length === 1);
    requireTrade(
      /^[1-9]\d{0,30}$/.test(p.amountIn) &&
        BigInt(p.amountIn) <= c.inputCap &&
        BigInt(p.amountIn) <= parseUnits("1000", MAINNET_QUOTE.decimals),
    );
    requireTrade(p.expectedOutput === p.amountIn && p.minimumOutput === p.amountIn);
    requireTrade(
      sameAddress(p.inputToken, MAINNET_QUOTE.address) &&
        sameAddress(p.outputToken, MAINNET_QUOTE.address) &&
        sameAddress(p.router, KYBER_ROUTER),
    );
    const step = p.steps[0];
    requireTrade(step.kind === "transfer" && sameAddress(step.to, MAINNET_QUOTE.address));
    requireTrade(
      /^[1-9]\d{0,9}$/.test(step.gas) &&
        BigInt(step.gas) <= 250000n &&
        /^[1-9]\d{0,17}$/.test(step.gasPrice),
    );
    const expected = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [recipient, BigInt(p.amountIn)],
    });
    requireTrade(step.data.toLowerCase() === expected.toLowerCase());
    const fee = BigInt(step.gas) * BigInt(step.gasPrice);
    requireTrade(c.feeCap === undefined || fee <= c.feeCap);
    requireTrade(
      p.estimatedFee && /^[1-9]\d{0,30}$/.test(p.estimatedFee) && BigInt(p.estimatedFee) <= fee,
    );
    return;
  }
  const c = mainnetTradeConfig();
  const router = KYBER_ROUTER;
  // The stock side must be one of this ticker's issuer variants.
  const stock = stockVariantByAddress(p.side === "buy" ? p.outputToken : p.inputToken);
  requireTrade(
    stock && stock.ticker === p.symbol && ["buy", "sell"].includes(p.side) && isAddress(p.wallet),
  );
  requireTrade(!p.variant || p.variant.symbol === stock.symbol);
  requireTrade(
    /^[a-f0-9-]{36}$/.test(p.id) &&
      p.orderId === keccak256(toBytes(`steward-mainnet-v1:${p.wallet.toLowerCase()}:${p.id}`)),
  );
  requireTrade(Number.isSafeInteger(p.deadline) && p.deadline > 0);
  requireTrade(BigInt(p.amountIn) <= parseUnits("1000", 18));
  requireTrade(
    sameAddress(p.router, router) &&
      sameAddress(p.inputToken, p.side === "buy" ? MAINNET_QUOTE.address : stock.address) &&
      sameAddress(p.outputToken, p.side === "buy" ? stock.address : MAINNET_QUOTE.address),
  );
  requireTrade(
    BigInt(p.amountIn) > 0n &&
      BigInt(p.minimumOutput) > 0n &&
      BigInt(p.minimumOutput) >= (BigInt(p.expectedOutput) * 99n) / 100n &&
      BigInt(p.minimumOutput) <= (BigInt(p.expectedOutput) * 99n) / 100n,
  );
  requireTrade((p.side === "buy" ? BigInt(p.amountIn) : BigInt(p.expectedOutput)) <= c.inputCap);
  requireTrade(p.steps.length === 2 || p.steps.length === 3);
  const kinds = p.steps.length === 3 ? ["reset", "approve", "trade"] : ["approve", "trade"];
  let fees = 0n;
  p.steps.forEach((step, index) => {
    requireTrade(
      step.kind === kinds[index] &&
        /^[1-9]\d{0,9}$/.test(step.gas) &&
        /^[1-9]\d{0,17}$/.test(step.gasPrice),
    );
    fees += BigInt(step.gas) * BigInt(step.gasPrice);
    if (step.kind !== "trade") {
      const call = decodeFunctionData({ abi: erc20Abi, data: step.data });
      requireTrade(sameAddress(step.to, p.inputToken) && call.functionName === "approve");
      requireTrade(
        sameAddress(call.args[0], router) &&
          call.args[1] === (step.kind === "reset" ? 0n : BigInt(p.amountIn)),
      );
    } else {
      requireTrade(sameAddress(step.to, router));
      validateRouterCall(p, step.data);
    }
  });
  requireTrade(c.feeCap === undefined || fees <= c.feeCap);
  if (p.estimatedFee !== undefined)
    requireTrade(/^[1-9]\d{0,30}$/.test(p.estimatedFee) && BigInt(p.estimatedFee) <= fees);
}

/** Validate outer swap terms; packed executor internals are trusted to Kyber. */
export function validateRouterCall(p: MainnetPlan, data: Hex) {
  const c = mainnetTradeConfig();
  const call = decodeFunctionData({ abi: mainnetRouterAbi, data });
  requireTrade(call.functionName === "swap");
  requireTrade(
    encodeFunctionData({
      abi: mainnetRouterAbi,
      functionName: "swap",
      args: call.args,
    }).toLowerCase() === data.toLowerCase(),
  );
  const e = call.args[0],
    d = e.desc;
  requireTrade(sameAddress(e.callTarget, c.executor) && sameAddress(e.approveTarget, zeroAddress));
  requireTrade(
    sameAddress(d.srcToken, p.inputToken) &&
      sameAddress(d.dstToken, p.outputToken) &&
      sameAddress(d.dstReceiver, p.wallet) &&
      d.amount === BigInt(p.amountIn) &&
      d.minReturnAmount === BigInt(p.minimumOutput) &&
      d.permit === "0x" &&
      d.feeReceivers.length === 0 &&
      d.feeAmounts.length === 0,
  );
  // User-approved provider trust model, matching Tokkenly's direct API flow.
  // We request a deadline from Kyber, but do not independently decode the
  // packed executor payload. Local review expiry prevents late submission;
  // it is not a guarantee about expiry of an already-broadcast transaction.
  if (d.flags === 512n) {
    requireTrade(/^0x(?:[a-fA-F0-9]{2})+$/.test(e.targetData) && e.targetData.length <= 200000);
    requireTrade(d.srcReceivers.length === 1 && d.srcAmounts.length === 1);
    requireTrade(
      sameAddress(d.srcReceivers[0], c.executor) && d.srcAmounts[0] === BigInt(p.amountIn),
    );
    return;
  }
  // Retain independent deadline checks for the standard simple-mode encoding.
  requireTrade(d.flags === 32n, "unsupported_kyber_route_encoding");
  requireTrade(d.srcReceivers.length === 0 && d.srcAmounts.length === 0);
  const [inner] = decodeAbiParameters(simpleSwapParameters, e.targetData);
  requireTrade(
    encodeAbiParameters(simpleSwapParameters, [inner]).toLowerCase() === e.targetData.toLowerCase(),
  );
  requireTrade(inner.deadline === BigInt(p.deadline), "route_deadline_mismatch");
  requireTrade(inner.positiveSlippageData === "0x");
  requireTrade(
    inner.firstPools.length > 0 &&
      inner.firstPools.length === inner.firstSwapAmounts.length &&
      inner.firstPools.length === inner.swapDatas.length,
  );
  requireTrade(
    inner.firstPools.every((a) => !sameAddress(a, zeroAddress) && !sameAddress(a, p.wallet)),
  );
  requireTrade(
    inner.firstSwapAmounts.every((a) => a > 0n) &&
      inner.firstSwapAmounts.reduce((a, b) => a + b, 0n) === BigInt(p.amountIn),
  );
}
