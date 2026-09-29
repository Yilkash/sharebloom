import { formatEther, formatUnits } from "viem";
import {
  MAINNET_ASSETS,
  MAINNET_NATIVE_SYMBOL,
  MAINNET_NETWORK_NAME,
  MAINNET_QUOTE,
  type MainnetStock,
} from "../networks/chain";
import type { MainnetPlan } from "./mainnet-trade";

// BigInt only: abbreviated outputs round down, displayed fee ceilings round up.
function shortAmount(raw: string, decimals: number, roundUp = false) {
  const value = BigInt(raw);
  const discarded = Math.max(0, value.toString().length - 6);
  const scale = 10n ** BigInt(discarded);
  const rounded = (roundUp ? (value + scale - 1n) / scale : value / scale) * scale;
  return formatUnits(rounded, decimals);
}
const feeCeiling = (p: MainnetPlan) =>
  p.steps.reduce((sum, step) => sum + BigInt(step.gas) * BigInt(step.gasPrice), 0n);
const expiry = (p: MainnetPlan) => new Date(p.deadline * 1000).toISOString().slice(11, 19) + " UTC";

// USDT and every stock variant on BNB Chain use 18 decimals.
const units = (p: MainnetPlan) => {
  const buy = p.side === "buy",
    stock = `${p.variant?.symbol ?? p.symbol} tokens`;
  return {
    buy,
    input: buy ? MAINNET_QUOTE.symbol : stock,
    output: buy ? stock : MAINNET_QUOTE.symbol,
  };
};

export function mainnetTradeReviewText(p: MainnetPlan) {
  const { buy, input, output } = units(p);
  const company = MAINNET_ASSETS[p.symbol as MainnetStock].name;
  const compared = p.routing?.length ?? 0;
  return [
    `*${buy ? "Buy" : "Sell"} ${company} (${p.symbol})*`,
    MAINNET_NETWORK_NAME,
    ...(p.variant
      ? [
          `Issuer: ${p.variant.issuer} (${p.variant.symbol})${compared > 1 ? ` · best fair price of ${compared}` : ""}`,
        ]
      : []),
    "",
    `${buy ? "Pay" : "Sell"}: ${formatUnits(BigInt(p.amountIn), 18)} ${input}`,
    `Receive: ≈ ${shortAmount(p.expectedOutput, 18)} ${output}`,
    `Minimum: ${shortAmount(p.minimumOutput, 18)} ${output}`,
    `Network fee: up to ${shortAmount(feeCeiling(p).toString(), 18, true)} ${MAINNET_NATIVE_SYMBOL}`,
    `Expires: ${expiry(p)}`,
    "",
    "Includes token approval. Failed trades may still cost gas.",
  ].join("\n");
}
export function mainnetTradeDetailsText(p: MainnetPlan) {
  const { buy, input, output } = units(p);
  return [
    `*${buy ? "Buy" : "Sell"} ${p.symbol} · Details*`,
    "Provider: KyberSwap",
    ...(p.variant ? [`Traded token: ${p.variant.symbol} (${p.variant.issuer})`] : []),
    `Input: ${formatUnits(BigInt(p.amountIn), 18)} ${input}`,
    `Estimated receive: ${formatUnits(BigInt(p.expectedOutput), 18)} ${output}`,
    `Minimum receive: ${formatUnits(BigInt(p.minimumOutput), 18)} ${output}`,
    "Price tolerance: 1%",
    ...(p.routing?.length
      ? [
          "",
          "*Issuers compared against Binance's reference price:*",
          ...p.routing.map((r) => `• ${r}`),
        ]
      : []),
    "",
    `Estimated network fee: ${formatEther(BigInt(p.estimatedFee ?? feeCeiling(p).toString()))} ${MAINNET_NATIVE_SYMBOL}`,
    `Maximum network fee: ${formatEther(feeCeiling(p))} ${MAINNET_NATIVE_SYMBOL}`,
    `Expires: ${expiry(p)}`,
    "",
    `Confirm authorizes ${p.steps.length} transactions with real assets, including exact token approval. Failed trades can cost gas and leave an approval.`,
    "The short review rounds received amounts down and the fee ceiling up. Exact amounts are shown here.",
    "",
    "Use Confirm or Cancel on the original review. Viewing details does not confirm or extend it.",
  ].join("\n");
}
