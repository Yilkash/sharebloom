import { validateMainnetPolicyRules } from "./mainnet-policy";
import { mainnetTradeOutput } from "./mainnet-trade-receipt";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { PrivyClient } from "@privy-io/node";
import {
  erc20Abi,
  getAddress,
  toHex,
  parseEventLogs,
  formatUnits,
  formatEther,
  type Hex,
} from "viem";
import {
  MAINNET_CAIP2,
  MAINNET_CHAIN_ID,
  MAINNET_EXECUTION_READY,
  MAINNET_EXPLORER_TX,
  MAINNET_NATIVE_SYMBOL,
  MAINNET_QUOTE,
} from "../networks/chain";
import { seal, unseal, senderKeyAccess } from "../whatsapp/config";
import { text } from "../whatsapp/menu";
import {
  mainnetRpc as rpc,
  requireTrade as ensure,
  sameAddress as same,
  checkMainnetRouter,
  validateMainnetPlan,
  executionGasLimit,
  broadcastGasPrice,
} from "./mainnet-trade";
import { walletStillMatches, type MainnetOrder, type MainnetReview } from "./mainnet-orders";
import {
  privyNeverBroadcast,
  unsentStepCanClose,
  type PrivyReferenceTransaction,
} from "./unsent-step";

type Step = {
  position: number;
  state: string;
  reference_id: string;
  idempotency_key: string;
  nonce: number | null;
  tx_hash: string | null;
};
const sdk = () =>
  new PrivyClient({
    appId: process.env.PRIVY_APP_ID!,
    appSecret: process.env.PRIVY_APP_SECRET!,
    maxRetries: 0,
    timeout: 15000,
    logLevel: "off",
  });
// Reconcile submitted steps even when the execution switch is turned off.
// A timeout past the durable submitting boundary NEVER triggers another send.
export async function processMainnetTrade(
  db: DatabaseSync,
  key: Buffer,
  allowed: Set<string>,
  publicAccess = false,
) {
  const canProcessSender = senderKeyAccess(allowed, key, publicAccess),
    now = Date.now(),
    lease = randomUUID();
  let row: MainnetOrder | undefined;
  db.exec("BEGIN IMMEDIATE");
  try {
    row = (
      db
        .prepare(
          "SELECT * FROM wa_mainnet_orders WHERE state IN ('queued','running','unknown') AND next_check<=? AND (lease_until IS NULL OR lease_until<?) ORDER BY created LIMIT 50",
        )
        .all(now, now) as MainnetOrder[]
    ).find((o) => canProcessSender(o.sender));
    if (row)
      db.prepare("UPDATE wa_mainnet_orders SET lease=?,lease_until=? WHERE id=?").run(
        lease,
        now + 180000,
        row.id,
      );
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  if (!row) return;
  const order = row;
  const notify = (kind: string, body: string) => {
    if (order.reply_until <= Date.now()) return;
    const { to } = unseal<{ to: string }>(order.recipient, key);
    db.prepare("INSERT OR IGNORE INTO wa_outbox(id,payload,expires) VALUES(?,?,?)").run(
      `mainnet:${order.id}:${kind}`,
      seal({ to, ...text(body) }, key),
      order.reply_until,
    );
  };
  const finish = (state: string, error: string | null, body?: string) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const changed = db
        .prepare(
          "UPDATE wa_mainnet_orders SET state=?,error=?,lease=NULL,lease_until=NULL,next_check=? WHERE id=? AND lease=?",
        )
        .run(state, error, Date.now() + 15000, order.id, lease);
      if (changed.changes && body) notify(state, body);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  let submitted = false;
  try {
    const review = unseal<MainnetReview>(order.payload, key),
      p = review.plan;
    const steps = db
      .prepare("SELECT * FROM wa_mainnet_steps WHERE order_id=? ORDER BY position")
      .all(order.id) as Step[];
    ensure(
      steps.length === p.steps.length &&
        p.id === order.id &&
        review.wallet.account_id === order.account_id &&
        same(review.wallet.address, p.wallet),
    );
    const step = steps.find((s) => s.state !== "confirmed");
    if (!step) {
      finish("confirmed", null);
      return;
    }
    const planned = p.steps[step.position];
    submitted = step.state !== "pending";
    if (!submitted) {
      ensure(
        MAINNET_EXECUTION_READY &&
          process.env.MAINNET_STOCK_TRADING_ENABLED === "true" &&
          order.confirmed_at &&
          order.expires > Date.now() + 15000,
        "trade_disabled_or_expired",
      );
      ensure(walletStillMatches(db, review));
      validateMainnetPlan(p);
      await checkMainnetRouter();
      const privy = sdk(),
        wallet = await privy.wallets().get(review.wallet.provider_id);
      ensure(
        same(wallet.address, p.wallet) &&
          wallet.external_id === review.wallet.external_id &&
          wallet.owner_id === review.wallet.owner_id &&
          wallet.policy_ids.length === 1 &&
          wallet.policy_ids[0] === review.wallet.policy_id,
      );
      const policy = await privy.policies().get(review.wallet.policy_id);
      ensure(
        policy.owner_id === review.wallet.owner_id &&
          policy.chain_type === "ethereum" &&
          policy.version === "1.0",
      );
      // A sell also needs the approve rule for its stock (added stocks gain it at rollout).
      validateMainnetPolicyRules(policy.rules, p.side === "send" ? undefined : p.inputToken);
      if (planned.kind === "trade") {
        const [allowance, balance] = await Promise.all([
          rpc.readContract({
            address: p.inputToken,
            abi: erc20Abi,
            functionName: "allowance",
            args: [p.wallet, p.router],
          }),
          rpc.readContract({
            address: p.inputToken,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [p.wallet],
          }),
        ]);
        ensure(allowance === BigInt(p.amountIn) && balance >= BigInt(p.amountIn));
      }
      const [gas, block, eth, nonce, latest, suggestedPrice] = await Promise.all([
        rpc.estimateGas({ account: p.wallet, to: planned.to, data: planned.data, value: 0n }),
        rpc.getBlock(),
        rpc.getBalance({ address: p.wallet }),
        rpc.getTransactionCount({ address: p.wallet, blockTag: "pending" }),
        rpc.getTransactionCount({ address: p.wallet, blockTag: "latest" }),
        rpc.getGasPrice(),
      ]);
      ensure(nonce === latest, "wallet_transaction_pending");
      // RPC suggestions can lag the latest block's base fee. Bid slightly above the
      // higher of the two so a base-fee uptick before inclusion can't reject the
      // broadcast, but never above the confirmed ceiling.
      ensure(
        typeof block.baseFeePerGas === "bigint" && block.baseFeePerGas >= 0n && suggestedPrice > 0n,
        "gas_price_unavailable",
      );
      const priceCeiling = BigInt(planned.gasPrice);
      ensure(block.baseFeePerGas <= priceCeiling, "network_fee_increased");
      const actualPrice = broadcastGasPrice(suggestedPrice, block.baseFeePerGas, priceCeiling);
      const gasLimit = executionGasLimit(gas, BigInt(planned.gas), priceCeiling, actualPrice);
      ensure(gasLimit !== null, "gas_estimate_increased");
      const remainingFee = p.steps
        .slice(step.position)
        .reduce((sum, s) => sum + BigInt(s.gas) * BigInt(s.gasPrice), 0n);
      ensure(eth >= remainingFee, "insufficient_eth_for_network_fee");
      ensure(walletStillMatches(db, review), "wallet_setup_changed");
      db.exec("BEGIN IMMEDIATE");
      try {
        ensure(
          db
            .prepare(
              "SELECT id FROM wa_mainnet_orders WHERE id=? AND lease=? AND lease_until>? AND expires>?",
            )
            .get(order.id, lease, Date.now(), Date.now() + 15000),
        );
        ensure(
          db
            .prepare(
              "UPDATE wa_mainnet_steps SET state='submitting',nonce=? WHERE order_id=? AND position=? AND state='pending'",
            )
            .run(nonce, order.id, step.position).changes === 1,
        );
        db.prepare("UPDATE wa_mainnet_orders SET state='running' WHERE id=? AND lease=?").run(
          order.id,
          lease,
        );
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
      submitted = true;
      step.nonce = nonce;
      const result = await privy
        .wallets()
        .ethereum()
        .sendTransaction(review.wallet.provider_id, {
          caip2: MAINNET_CAIP2,
          sponsor: false,
          reference_id: step.reference_id,
          idempotency_key: step.idempotency_key,
          request_expiry: Math.min(Date.now() + 60000, order.expires),
          params: {
            transaction: {
              chain_id: MAINNET_CHAIN_ID,
              to: planned.to,
              value: "0x0",
              data: planned.data,
              nonce: toHex(nonce),
              gas_limit: toHex(gasLimit),
              gas_price: toHex(actualPrice),
              type: 0,
            },
          },
          authorization_context: {
            authorization_private_keys: [process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY!],
          },
        });
      ensure(/^0x[a-fA-F0-9]{64}$/.test(result.hash));
      step.tx_hash = result.hash;
      db.prepare(
        "UPDATE wa_mainnet_steps SET state='broadcast',tx_hash=? WHERE order_id=? AND position=?",
      ).run(result.hash, order.id, step.position);
    }
    if (!step.tx_hash) {
      ensure(review.wallet.app_id === process.env.PRIVY_APP_ID);
      const response = await fetch(
        "https://api.privy.io/v1/transactions?reference_id=" +
          encodeURIComponent(step.reference_id),
        {
          headers: {
            Authorization:
              "Basic " +
              Buffer.from(process.env.PRIVY_APP_ID + ":" + process.env.PRIVY_APP_SECRET).toString(
                "base64",
              ),
            "privy-app-id": process.env.PRIVY_APP_ID!,
          },
          signal: AbortSignal.timeout(10000),
          redirect: "error",
        },
      );
      ensure(response.ok);
      const result = (await response.json()) as { transactions?: PrivyReferenceTransaction[] };
      const found = result.transactions ?? [];
      console.warn("Mainnet reconciliation lookup", {
        order: order.id.slice(0, 8),
        step: step.position,
        found: found.length,
        status: found[0]?.status ?? null,
        hasHash: Boolean(found[0]?.transaction_hash),
      });
      if (
        privyNeverBroadcast(found, {
          walletId: review.wallet.provider_id,
          referenceId: step.reference_id,
        })
      ) {
        const [latestNonce, pendingNonce] = await Promise.all([
          rpc.getTransactionCount({ address: p.wallet, blockTag: "latest" }),
          rpc.getTransactionCount({ address: p.wallet, blockTag: "pending" }),
        ]);
        if (
          unsentStepCanClose({
            neverBroadcast: true,
            orderExpires: order.expires,
            now: Date.now(),
            stepNonce: step.nonce ?? null,
            latestNonce,
            pendingNonce,
          })
        ) {
          const earlier = db
            .prepare(
              "SELECT 1 FROM wa_mainnet_steps WHERE order_id=? AND position<? AND state='confirmed' LIMIT 1",
            )
            .get(order.id, step.position);
          db.prepare(
            "UPDATE wa_mainnet_steps SET state='failed' WHERE order_id=? AND position=? AND state='submitting' AND tx_hash IS NULL",
          ).run(order.id, step.position);
          finish(
            "failed",
            "not_broadcast",
            `This ${p.side === "send" ? "payment" : "trade"} was not sent. ${earlier ? "An earlier approval was confirmed, so its fee was charged and the allowance may remain." : "Nothing reached the chain; no gas was spent."} You can start a new one.`,
          );
          return;
        }
      }
      ensure(found.length === 1);
      const tx = found[0];
      ensure(
        tx.wallet_id === review.wallet.provider_id &&
          tx.reference_id === step.reference_id &&
          tx.caip2 === MAINNET_CAIP2 &&
          tx.transaction_hash &&
          /^0x[a-fA-F0-9]{64}$/.test(tx.transaction_hash),
      );
      step.tx_hash = tx.transaction_hash;
      db.prepare(
        "UPDATE wa_mainnet_steps SET state='broadcast',tx_hash=? WHERE order_id=? AND position=?",
      ).run(step.tx_hash, order.id, step.position);
    }
    const hash = step.tx_hash as Hex;
    ensure((await rpc.getChainId()) === MAINNET_CHAIN_ID);
    const [receipt, tx, head] = await Promise.all([
      rpc.getTransactionReceipt({ hash }),
      rpc.getTransaction({ hash }),
      rpc.getBlockNumber(),
    ]);
    const block = await rpc.getBlock({ blockNumber: receipt.blockNumber });
    ensure(
      head >= receipt.blockNumber + 12n &&
        block.hash === receipt.blockHash &&
        tx.blockHash === receipt.blockHash,
    );
    ensure(
      same(tx.from, p.wallet) &&
        tx.to &&
        same(tx.to, planned.to) &&
        tx.chainId === MAINNET_CHAIN_ID &&
        tx.value === 0n &&
        tx.input === planned.data &&
        tx.nonce === step.nonce,
    );
    if (receipt.status !== "success") {
      db.prepare("UPDATE wa_mainnet_steps SET state='failed' WHERE order_id=? AND position=?").run(
        order.id,
        step.position,
      );
      finish(
        "failed",
        "execution_reverted",
        `Mainnet transaction stopped: ${planned.kind} reverted. Network fees may be charged; an earlier token approval may remain.\n${MAINNET_EXPLORER_TX}${hash}`,
      );
      return;
    }
    let amountOut: bigint | null = null;
    if (planned.kind === "trade") {
      amountOut = mainnetTradeOutput(p, receipt.logs);
    } else if (planned.kind === "transfer") {
      const transfers = parseEventLogs({
        abi: erc20Abi,
        eventName: "Transfer",
        logs: receipt.logs.filter((l) => same(l.address, MAINNET_QUOTE.address)),
      });
      ensure(
        p.transferTo &&
          transfers.length === 1 &&
          same(transfers[0].args.from, p.wallet) &&
          same(transfers[0].args.to, p.transferTo) &&
          transfers[0].args.value === BigInt(p.amountIn),
      );
      amountOut = BigInt(p.amountIn);
    } else {
      const approvals = parseEventLogs({
        abi: erc20Abi,
        eventName: "Approval",
        logs: receipt.logs.filter((l) => same(l.address, p.inputToken)),
      });
      ensure(
        approvals.length === 1 &&
          same(approvals[0].args.owner, p.wallet) &&
          same(approvals[0].args.spender, p.router) &&
          approvals[0].args.value === (planned.kind === "reset" ? 0n : BigInt(p.amountIn)),
      );
    }
    db.exec("BEGIN IMMEDIATE");
    try {
      ensure(
        db
          .prepare("SELECT id FROM wa_mainnet_orders WHERE id=? AND lease=? AND lease_until>?")
          .get(order.id, lease, Date.now()),
      );
      db.prepare(
        "UPDATE wa_mainnet_steps SET state='confirmed' WHERE order_id=? AND position=?",
      ).run(order.id, step.position);
      db.prepare(
        "UPDATE wa_mainnet_orders SET state=?,lease=NULL,lease_until=NULL,next_check=0,error=NULL WHERE id=? AND lease=?",
      ).run(amountOut !== null ? "confirmed" : "running", order.id, lease);
      if (amountOut !== null)
        notify(
          "confirmed",
          p.side === "send"
            ? `Payment complete ✅\n${formatUnits(amountOut, MAINNET_QUOTE.decimals)} ${MAINNET_QUOTE.symbol}\nTo: ${p.transferTo}\nNetwork fee: ${formatEther(receipt.gasUsed * receipt.effectiveGasPrice)} ${MAINNET_NATIVE_SYMBOL}\n${MAINNET_EXPLORER_TX}${hash}`
            : `Trade complete ✅\n${p.side === "buy" ? "Bought" : "Received"}: ${formatUnits(amountOut, 18)} ${p.side === "buy" ? (p.variant?.symbol ?? p.symbol) : MAINNET_QUOTE.symbol}${p.variant ? ` (${p.variant.issuer})` : ""}\nSwap network fee: ${formatEther(receipt.gasUsed * receipt.effectiveGasPrice)} ${MAINNET_NATIVE_SYMBOL} (approvals charged separately)\n${MAINNET_EXPLORER_TX}${hash}`,
        );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  } catch (error) {
    console.warn("Mainnet order step stopped", {
      order: order.id.slice(0, 8),
      submitted,
      error:
        error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 300) : String(error),
    });
    if (submitted)
      finish(
        "unknown",
        "reconciliation_pending",
        Date.now() - (order.confirmed_at ?? now) > 60000
          ? "Your mainnet transaction is still being checked. Don’t resubmit. Ask for recent activity."
          : undefined,
      );
    else {
      const reasons: Record<string, string> = {
        network_fee_increased: "Network fees rose above this review’s limit.",
        gas_price_unavailable: "Current network fees could not be checked.",
        gas_estimate_increased: "The network fee would now exceed the maximum you confirmed.",
        wallet_transaction_pending: "Another wallet transaction is still pending.",
        insufficient_eth_for_network_fee: `The wallet needs more ${MAINNET_NATIVE_SYMBOL} for gas.`,
        no_fair_price: "No issuer offered a fair price for this trade right now.",
        stock_not_trading: "This stock token is not trading right now.",
        wallet_setup_changed: "The wallet setup changed.",
        trade_disabled_or_expired: "The review expired or trading was disabled.",
        stock_not_enabled_for_selling: "Selling this stock is not enabled yet.",
      };
      const code =
        error instanceof Error && error.message in reasons ? error.message : "preflight_failed";
      const attempted = db
        .prepare("SELECT 1 FROM wa_mainnet_steps WHERE order_id=? AND state!='pending' LIMIT 1")
        .get(order.id);
      finish(
        "failed",
        code,
        `${reasons[code] ?? "The trade checks could not complete."} ${attempted ? "Earlier approval fees or allowances may remain." : "Nothing was submitted; no gas was spent."} Request a fresh trade review.`,
      );
    }
  }
}
