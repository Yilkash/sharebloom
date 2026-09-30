import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { PrivyClient } from "@privy-io/node";
import {
  erc20Abi,
  formatEther,
  getAddress,
  isAddress,
  parseUnits,
  toHex,
  type Address,
} from "viem";
import { MAINNET_CAIP2, MAINNET_CHAIN_ID, MAINNET_QUOTE } from "../networks/chain";
import { broadcastGasPrice, mainnetRpc } from "./mainnet-trade";

// One-time welcome top-up: a new user holding USDT but no BNB gets a small amount of BNB for
// network fees from a Sharebloom-funded Privy wallet. The wallet's own Privy policy only allows
// native BNB transfers on chain 56 up to the top-up amount (scripts/gas-wallet-create.ts).
export const GAS_TOPUP_DEFAULT_WEI = 200_000_000_000_000n; // 0.0002 BNB
const MIN_USDT = parseUnits("1", MAINNET_QUOTE.decimals);
const LOW_BALANCE_WEI = 3_000_000_000_000_000n; // warn below 0.003 BNB
const TRANSFER_GAS = 21_000n;

export type GasTopupResult = "sent" | "pending" | "skipped";

export function migrateGasTopups(db: DatabaseSync) {
  // One row per account and per wallet, ever. A row that never reached Privy is removed.
  db.exec(
    "CREATE TABLE IF NOT EXISTS wa_gas_topups(account_id TEXT PRIMARY KEY,wallet TEXT NOT NULL UNIQUE,amount TEXT NOT NULL,reference_id TEXT NOT NULL UNIQUE,idempotency_key TEXT NOT NULL UNIQUE,state TEXT NOT NULL,tx_hash TEXT,created INTEGER NOT NULL)",
  );
}

export function gasTopupConfig() {
  const walletId = process.env.GAS_TOPUP_WALLET_ID?.trim();
  const address = process.env.GAS_TOPUP_WALLET_ADDRESS?.trim();
  if (!walletId || !address || !isAddress(address)) return undefined;
  const amountText = process.env.GAS_TOPUP_WEI?.trim();
  const limitText = process.env.GAS_TOPUP_DAILY_LIMIT?.trim();
  const amount = amountText && /^[1-9]\d{0,17}$/.test(amountText) ? BigInt(amountText) : null;
  const dailyLimit = limitText && /^\d{1,4}$/.test(limitText) ? Number(limitText) : 10;
  return {
    walletId,
    address: getAddress(address),
    // The wallet's Privy policy refuses anything above the default, so only smaller amounts apply.
    amount: amount && amount <= GAS_TOPUP_DEFAULT_WEI ? amount : GAS_TOPUP_DEFAULT_WEI,
    dailyLimit,
  };
}

/** Decide from on-chain and stored facts whether this wallet may receive its one top-up. */
export function gasTopupEligible(input: {
  used: boolean;
  sentToday: number;
  dailyLimit: number;
  userUsdt: bigint;
  userNative: bigint;
  amount: bigint;
  funderNative: bigint;
  transferFee: bigint;
}) {
  return (
    !input.used &&
    input.sentToday < input.dailyLimit &&
    input.userUsdt >= MIN_USDT &&
    input.userNative < input.amount &&
    input.funderNative >= input.amount + input.transferFee
  );
}

let privy: PrivyClient | undefined;
const client = () =>
  (privy ??= new PrivyClient({
    appId: process.env.PRIVY_APP_ID!,
    appSecret: process.env.PRIVY_APP_SECRET!,
    maxRetries: 0,
    timeout: 15000,
    logLevel: "off",
  }));

export async function welcomeGasTopup(
  db: DatabaseSync,
  account: string,
  wallet: Address,
): Promise<GasTopupResult> {
  const config = gasTopupConfig();
  if (!config || !process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY) return "skipped";
  migrateGasTopups(db);
  db.prepare("DELETE FROM wa_gas_topups WHERE state='failed'").run();
  const used = Boolean(
    db
      .prepare("SELECT 1 FROM wa_gas_topups WHERE account_id=? OR lower(wallet)=lower(?)")
      .get(account, wallet),
  );
  if (used) return "skipped";
  const sentToday = (
    db
      .prepare("SELECT count(*) AS n FROM wa_gas_topups WHERE created>?")
      .get(Date.now() - 24 * 3600_000) as { n: number }
  ).n;

  const [userUsdt, userNative, funderNative, suggested, block] = await Promise.all([
    mainnetRpc.readContract({
      address: MAINNET_QUOTE.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [wallet],
    }),
    mainnetRpc.getBalance({ address: wallet }),
    mainnetRpc.getBalance({ address: config.address }),
    mainnetRpc.getGasPrice(),
    mainnetRpc.getBlock(),
  ]);
  const gasPrice = broadcastGasPrice(suggested, block.baseFeePerGas ?? 0n, suggested * 2n);
  const transferFee = TRANSFER_GAS * gasPrice;
  if (funderNative < LOW_BALANCE_WEI)
    console.warn("Gas top-up wallet is low", { balance: formatEther(funderNative) });
  if (
    !gasTopupEligible({
      used,
      sentToday,
      dailyLimit: config.dailyLimit,
      userUsdt,
      userNative,
      amount: config.amount,
      funderNative,
      transferFee,
    })
  )
    return "skipped";

  // Reserve first: the unique keys stop a second concurrent top-up for this account or wallet.
  const referenceId = `gas-topup:${account}`;
  const idempotencyKey = randomUUID();
  try {
    db.prepare(
      "INSERT INTO wa_gas_topups(account_id,wallet,amount,reference_id,idempotency_key,state,created) VALUES(?,?,?,?,?,'sending',?)",
    ).run(account, wallet, config.amount.toString(), referenceId, idempotencyKey, Date.now());
  } catch {
    return "skipped";
  }

  let hash: `0x${string}`;
  try {
    const result = await client()
      .wallets()
      .ethereum()
      .sendTransaction(config.walletId, {
        caip2: MAINNET_CAIP2,
        sponsor: false,
        reference_id: referenceId,
        idempotency_key: idempotencyKey,
        params: {
          transaction: {
            chain_id: MAINNET_CHAIN_ID,
            to: wallet,
            value: toHex(config.amount),
            gas_limit: toHex(TRANSFER_GAS),
            gas_price: toHex(gasPrice),
            type: 0,
          },
        },
        authorization_context: {
          authorization_private_keys: [process.env.PRIVY_AUTHORIZATION_PRIVATE_KEY],
        },
      });
    if (!/^0x[a-fA-F0-9]{64}$/.test(result.hash)) throw Error("invalid_hash");
    hash = result.hash as `0x${string}`;
  } catch (error) {
    // A 4xx from Privy means it refused the request, so nothing was sent and the user may be
    // topped up later. Anything else is uncertain; keep the row so we never pay twice.
    const status = (error as { status?: number }).status;
    const refused = typeof status === "number" && status >= 400 && status < 500;
    db.prepare("UPDATE wa_gas_topups SET state=? WHERE account_id=?").run(
      refused ? "failed" : "unknown",
      account,
    );
    console.warn("Gas top-up not sent", { status: status ?? null, refused });
    return "skipped";
  }
  db.prepare("UPDATE wa_gas_topups SET state='sent',tx_hash=? WHERE account_id=?").run(
    hash,
    account,
  );
  try {
    const receipt = await mainnetRpc.waitForTransactionReceipt({ hash, timeout: 20_000 });
    if (receipt.status !== "success") return "skipped";
    db.prepare("UPDATE wa_gas_topups SET state='confirmed' WHERE account_id=?").run(account);
    return "sent";
  } catch {
    return "pending";
  }
}
