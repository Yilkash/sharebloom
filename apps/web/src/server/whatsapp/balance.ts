import type { DatabaseSync } from "node:sqlite";
import {
  createPublicClient,
  erc20Abi,
  formatEther,
  formatUnits,
  getAddress,
  http,
  parseUnits,
} from "viem";
import { senderLookup } from "./config";
import { text } from "./menu";

// Read-only client: no signer, authorization key, transfer or funding capability.
const client = createPublicClient({
  transport: http("https://rpc.testnet.chain.robinhood.com", { timeout: 8000, retryCount: 1 }),
});
const token = "0x13800afeea6f8688547770052b395099758d9a5b";
export async function balanceReply(db: DatabaseSync, key: Buffer, phone: string, amount?: string) {
  const sender = senderLookup(phone, key);
  const wallet = db
    .prepare(
      `SELECT w.address,w.chain,a.status FROM wa_accounts a
    LEFT JOIN wa_managed_wallets w ON w.account_id=a.id WHERE a.sender=?`,
    )
    .get(sender) as { address: string | null; chain: number | null; status: string } | undefined;
  if (!wallet) return text("Create your Sharebloom test account first. Type Menu to begin.");
  if (wallet.status !== "active")
    return text("This account is paused. Contact the Sharebloom operator for recovery.");
  if (!wallet.address)
    return text("Your wallet is not ready yet. Choose My account to check setup.");
  try {
    if (wallet.chain !== 46630 || (await client.getChainId()) !== 46630)
      throw new Error("wrong_chain");
    const address = getAddress(wallet.address);
    const block = await client.getBlock();
    const [demoUsd, testEth, decimals] = await Promise.all([
      client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
        blockNumber: block.number,
      }),
      client.getBalance({ address, blockNumber: block.number }),
      client.readContract({
        address: token,
        abi: erc20Abi,
        functionName: "decimals",
        blockNumber: block.number,
      }),
    ]);
    if (decimals !== 6 || Date.now() - Number(block.timestamp) * 1000 > 120000)
      throw new Error("unreliable_snapshot");
    // Account may have been paused while waiting for RPC.
    const current = db.prepare("SELECT status FROM wa_accounts WHERE sender=?").get(sender) as
      | { status: string }
      | undefined;
    if (current?.status !== "active")
      return text("This account is paused. Contact the Sharebloom operator for recovery.");
    if (amount !== undefined) {
      if (!/^(?:0|[1-9]\d{0,3})(?:\.\d{1,6})?$/.test(amount) || parseUnits(amount, 6) <= 0n)
        return text("Enter a positive Demo USD amount to check.");
      const enough = demoUsd >= parseUnits(amount, 6);
      const reserve = 100000000000000n;
      return text(
        `${amount} Demo USD: ${enough ? "balance covers it" : "insufficient balance"}.\nFee reserve (0.0001 test ETH): ${testEth >= reserve ? "covered" : "not covered"}.\n\nBalance: ${formatUnits(demoUsd, decimals)} Demo USD\nGas balance: ${formatEther(testEth)} test ETH\n\nFinal fees, pending payments and limits are checked at review. Nothing sent.`,
      );
    }
    return text(
      `Your balance · Robinhood testnet\n\nDemo USD: ${formatUnits(demoUsd, decimals)}\nGas: ${formatEther(testEth)} test ETH\n\n${demoUsd === 0n && testEth === 0n ? "Choose Receive payment to fund your test wallet.\n" : ""}Test tokens have no monetary value.\nType Balance to refresh.`,
    );
  } catch {
    // Never turn an unavailable RPC or token response into an invented zero balance.
    return text(
      "I couldn’t retrieve your balance right now. Please try View balance again shortly. No payment was made.",
    );
  }
}
