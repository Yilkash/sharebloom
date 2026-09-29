import { KYBER_ROUTER, mainnetRouterAbi, requireTrade, sameAddress } from "./mainnet-trade";
import { MAINNET_CHAIN_ID, MAINNET_QUOTE, MAINNET_STOCK_TOKENS } from "../networks/chain";

// Privy wallet policy for Sharebloom on BNB Chain. The wallet may only: approve USDT or one
// of the listed stock tokens, call KyberSwap's router `swap`, and transfer USDT. Every rule
// pins chain 56, the exact contract, zero native value and the function name.
const chainId = String(MAINNET_CHAIN_ID);
const approveAbi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
];
const transferAbi = [
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
];
function rule(name: string, to: string, functionName: string, abi: unknown) {
  return {
    name,
    method: "eth_sendTransaction" as const,
    action: "ALLOW" as const,
    conditions: [
      {
        field_source: "ethereum_transaction" as const,
        field: "chain_id" as const,
        operator: "eq" as const,
        value: chainId,
      },
      {
        field_source: "ethereum_transaction" as const,
        field: "to" as const,
        operator: "eq" as const,
        value: to,
      },
      {
        field_source: "ethereum_transaction" as const,
        field: "value" as const,
        operator: "eq" as const,
        value: "0x0",
      },
      {
        field_source: "ethereum_calldata" as const,
        field: "function_name" as const,
        operator: "eq" as const,
        value: functionName,
        abi,
      },
    ],
  };
}
export const stockApproveRule = (address: string) =>
  rule(`Approve ${address}`, address, "approve", approveAbi);
/** The complete policy. Generated from the token list so the policy and code cannot drift. */
export function mainnetPolicyRules() {
  return [
    stockApproveRule(MAINNET_QUOTE.address),
    ...MAINNET_STOCK_TOKENS.map((t) => stockApproveRule(t.address)),
    rule(`Send ${MAINNET_QUOTE.symbol}`, MAINNET_QUOTE.address, "transfer", transferAbi),
    rule(
      "KyberSwap stock swap",
      KYBER_ROUTER,
      "swap",
      mainnetRouterAbi.filter((x) => x.type === "function" || x.type === "event"),
    ),
  ];
}
export function canonicalPolicy(x: unknown): string {
  if (Array.isArray(x)) return "[" + x.map(canonicalPolicy).join(",") + "]";
  if (x && typeof x === "object")
    return (
      "{" +
      Object.entries(x)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonicalPolicy(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(x);
}
type Rule = {
  action: string;
  method: string;
  conditions: {
    field_source: string;
    field: string;
    operator: string;
    value: unknown;
    abi?: unknown;
  }[];
};
/**
 * The live policy must contain exactly the expected rules: every stock and USDT approval,
 * the Kyber swap and the USDT transfer, each once, and nothing else. `approveToken`
 * additionally requires the approval rule for a trade's input token.
 */
export function validateMainnetPolicyRules(rules: Rule[], approveToken?: string) {
  const expected: [string, string][] = [
    [MAINNET_QUOTE.address, "approve"],
    ...MAINNET_STOCK_TOKENS.map((t): [string, string] => [t.address, "approve"]),
    [KYBER_ROUTER, "swap"],
    [MAINNET_QUOTE.address, "transfer"],
  ];
  const seen = new Set<string>();
  for (const rule of rules) {
    requireTrade(
      rule.action === "ALLOW" &&
        rule.method === "eth_sendTransaction" &&
        rule.conditions.length === 4,
    );
    const eq = (source: string, field: string, value: string) =>
      rule.conditions.some(
        (c) =>
          c.field_source === source &&
          c.field === field &&
          c.operator === "eq" &&
          sameAddress(String(c.value), value),
      );
    requireTrade(
      eq("ethereum_transaction", "chain_id", chainId) && eq("ethereum_transaction", "value", "0x0"),
    );
    const match = expected.find(
      ([address, name]) =>
        eq("ethereum_transaction", "to", address) && eq("ethereum_calldata", "function_name", name),
    );
    requireTrade(match && !seen.has(match[0].toLowerCase() + match[1]));
    seen.add(match[0].toLowerCase() + match[1]);
  }
  requireTrade(
    expected.every(([address, name]) => seen.has(address.toLowerCase() + name)),
    "mainnet_policy_mismatch",
  );
  requireTrade(
    !approveToken || seen.has(approveToken.toLowerCase() + "approve"),
    "stock_not_enabled_for_selling",
  );
}
