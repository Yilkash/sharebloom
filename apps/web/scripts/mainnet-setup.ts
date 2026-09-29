import { ensureMainnetWallet } from "../src/server/stocks/mainnet-wallet";
import { getAddress, erc20Abi, formatEther, formatUnits } from "viem";
import { whatsappConfig } from "../src/server/whatsapp/config";
import { WhatsAppStore } from "../src/server/whatsapp/store";
import { mainnetWallet } from "../src/server/stocks/mainnet-orders";
import {
  checkMainnetRouter,
  mainnetRpc,
  requireTrade as ensure,
} from "../src/server/stocks/mainnet-trade";
import { mainnetPolicyRules } from "../src/server/stocks/mainnet-policy";
import {
  MAINNET_CHAIN_ID,
  MAINNET_QUOTE,
  MAINNET_EXECUTION_READY,
} from "../src/server/networks/chain";

async function main() {
  if (process.argv.includes("--policy-template")) {
    // Generated from the configured token list; see src/server/stocks/mainnet-policy.ts.
    console.log(
      JSON.stringify(
        {
          name: "Sharebloom BNB Chain trades",
          version: "1.0",
          chain_type: "ethereum",
          rules: mainnetPolicyRules(),
        },
        null,
        2,
      ),
    );
    return;
  }
  const config = whatsappConfig(),
    store = new WhatsAppStore(config.key);
  try {
    const accounts = store.db.prepare("SELECT id FROM wa_accounts WHERE status='active'").all() as {
      id: string;
    }[];
    const arg = process.argv.find((v) => v.startsWith("--account="))?.slice(10);
    const account = arg ?? (accounts.length === 1 ? accounts[0].id : undefined);
    ensure(
      account && accounts.some((a) => a.id === account),
      "choose_active_account_with_account_flag",
    );
    const names = [
      "MAINNET_KYBER_EXECUTOR",
      "MAINNET_KYBER_EXECUTOR_CODEHASH",
      "MAINNET_ROUTER_CODEHASH",
      "PRIVY_MAINNET_POLICY_ID",
      "MAINNET_MAX_USDT_PER_TRADE",
    ];
    console.log(
      "Configuration:",
      Object.fromEntries(names.map((n) => [n, process.env[n]?.trim() ? "set" : "missing"])),
    );
    console.log(
      "Trading enabled:",
      MAINNET_EXECUTION_READY && process.env.MAINNET_STOCK_TRADING_ENABLED === "true",
    );
    console.log("Execution validation complete:", MAINNET_EXECUTION_READY);
    console.log(
      "Gas payment:",
      "Fees estimated automatically per review; wallet pays BNB. Sponsorship is off.",
    );
    console.log(
      "Dedicated mainnet wallet:",
      mainnetWallet(store.db, account) ? "configured" : "missing",
    );
    const creatingWallet = process.argv.includes("--create-wallet");
    if (!creatingWallet && names.some((n) => !process.env[n]?.trim())) {
      console.log("Mainnet setup incomplete. No provider changes or transactions made.");
      return;
    }
    // An empty wallet can be provisioned before trade validation and fee limits.
    // Execution still requires checkMainnetRouter in both preparation and submission.
    const policy = process.env.PRIVY_MAINNET_POLICY_ID?.trim();
    ensure(policy, "mainnet_policy_required");
    if (!creatingWallet) {
      await checkMainnetRouter();
      console.log("KyberSwap router and executor code pins verified.");
    }
    let wallet = mainnetWallet(store.db, account);
    if (!wallet && process.argv.includes("--create-wallet")) {
      wallet = await ensureMainnetWallet(store.db, account);
    }
    if (!wallet) {
      console.log(
        "Dedicated mainnet wallet missing. Use --create-wallet after configuring the separate policy.",
      );
      return;
    }
    const address = getAddress(wallet.address);
    const [eth, usdg] = await Promise.all([
      mainnetRpc.getBalance({ address }),
      mainnetRpc.readContract({
        address: MAINNET_QUOTE.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [address],
      }),
    ]);
    console.log({
      wallet: address,
      chain: MAINNET_CHAIN_ID,
      BNB: formatEther(eth),
      USDT: formatUnits(usdg, MAINNET_QUOTE.decimals),
    });
    console.log("No trade or funding transaction submitted.");
  } finally {
    store.close();
  }
}
main().catch(() => {
  console.error(
    "Mainnet setup stopped. Check configuration, account selection and provider status. No secrets are logged; uncertain wallet creation must be recovered by its saved external ID.",
  );
  process.exitCode = 1;
});
