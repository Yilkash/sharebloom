import { erc20Abi, parseEventLogs, type Log } from "viem";
import {
  mainnetRouterAbi,
  requireTrade as ensure,
  sameAddress as same,
  type MainnetPlan,
} from "./mainnet-trade";
/** Verify a Kyber swap receipt: exactly one Swapped event and matching token transfers. */
export function mainnetTradeOutput(p: MainnetPlan, logs: Log[]): bigint {
  const routerLogs = logs.filter((l) => same(l.address, p.router));
  const events = parseEventLogs({ abi: mainnetRouterAbi, eventName: "Swapped", logs: routerLogs });
  ensure(events.length === 1);
  const e = events[0].args;
  ensure(
    same(e.sender, p.wallet) &&
      same(e.srcToken, p.inputToken) &&
      same(e.dstToken, p.outputToken) &&
      same(e.dstReceiver, p.wallet) &&
      e.spentAmount === BigInt(p.amountIn) &&
      e.returnAmount >= BigInt(p.minimumOutput),
  );
  const amountOut = e.returnAmount;
  const transfers = parseEventLogs({
    abi: erc20Abi,
    eventName: "Transfer",
    logs: logs.filter((l) => same(l.address, p.inputToken) || same(l.address, p.outputToken)),
  });
  const spent = transfers
    .filter((l) => same(l.address, p.inputToken) && same(l.args.from, p.wallet))
    .reduce((n, l) => n + l.args.value, 0n);
  const received = transfers
    .filter((l) => same(l.address, p.outputToken) && same(l.args.to, p.wallet))
    .reduce((n, l) => n + l.args.value, 0n);
  const outputSent = transfers
    .filter((l) => same(l.address, p.outputToken) && same(l.args.from, p.wallet))
    .reduce((n, l) => n + l.args.value, 0n);
  ensure(spent === BigInt(p.amountIn) && received === amountOut && outputSent === 0n);
  return amountOut;
}
