import { defineChain } from "viem";

// Sharebloom trades tokenized US stocks on BNB Chain mainnet (chain 56).
export const mainnetChain = defineChain({
  id: 56,
  name: "BNB Chain",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: { default: { http: ["https://bsc-dataseed.bnbchain.org"] } },
  blockExplorers: { default: { name: "BscScan", url: "https://bscscan.com" } },
  testnet: false,
});
export const MAINNET_CHAIN_ID = 56;
export const MAINNET_CAIP2 = "eip155:56";
export const MAINNET_NETWORK_NAME = "BNB Chain";
export const MAINNET_NATIVE_SYMBOL = "BNB";
export const MAINNET_EXPLORER_TX = "https://bscscan.com/tx/";
export const KYBER_CHAIN_SLUG = "bsc";

export type StockIssuer = "bStocks" | "Ondo" | "xStocks";
export type StockVariant = {
  issuer: StockIssuer;
  symbol: string;
  address: `0x${string}`;
  decimals: number;
};
// Each ticker is issued three ways on BNB Chain. Addresses and decimals come from Binance's
// RWA token list (chainId 56) and are re-verified against it before every trade. Sharebloom
// quotes every variant and trades the one with the best fair price; see stock-routing.ts.
export const MAINNET_ASSETS = {
  AAPL: {
    name: "Apple",
    variants: [
      {
        issuer: "bStocks",
        symbol: "AAPLB",
        address: "0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a",
        decimals: 18,
      },
      {
        issuer: "Ondo",
        symbol: "AAPLon",
        address: "0x390a684ef9cade28a7ad0dfa61ab1eb3842618c4",
        decimals: 18,
      },
      {
        issuer: "xStocks",
        symbol: "AAPLx",
        address: "0x9d275685dc284c8eb1c79f6aba7a63dc75ec890a",
        decimals: 18,
      },
    ],
  },
  NVDA: {
    name: "NVIDIA",
    variants: [
      {
        issuer: "bStocks",
        symbol: "NVDAB",
        address: "0x02fca66c1d1afb4e2a7884261eb00f63598a7436",
        decimals: 18,
      },
      {
        issuer: "Ondo",
        symbol: "NVDAon",
        address: "0xa9ee28c80f960b889dfbd1902055218cba016f75",
        decimals: 18,
      },
      {
        issuer: "xStocks",
        symbol: "NVDAx",
        address: "0xc845b2894dbddd03858fd2d643b4ef725fe0849d",
        decimals: 18,
      },
    ],
  },
  TSLA: {
    name: "Tesla",
    variants: [
      {
        issuer: "bStocks",
        symbol: "TSLAB",
        address: "0x5b1910eaad6450e50f816082aa078c41f10c292f",
        decimals: 18,
      },
      {
        issuer: "Ondo",
        symbol: "TSLAon",
        address: "0x2494b603319d4d9f9715c9f4496d9e0364b59d93",
        decimals: 18,
      },
      {
        issuer: "xStocks",
        symbol: "TSLAx",
        address: "0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0",
        decimals: 18,
      },
    ],
  },
  MSFT: {
    name: "Microsoft",
    variants: [
      {
        issuer: "bStocks",
        symbol: "MSFTB",
        address: "0x80106cb3ead06659a5ad19df39d9b4733863b9b0",
        decimals: 18,
      },
      {
        issuer: "Ondo",
        symbol: "MSFTon",
        address: "0x6bfe75d1ad432050ea973c3a3dcd88f02e2444c3",
        decimals: 18,
      },
      {
        issuer: "xStocks",
        symbol: "MSFTx",
        address: "0x5621737f42dae558b81269fcb9e9e70c19aa6b35",
        decimals: 18,
      },
    ],
  },
  GOOGL: {
    name: "Alphabet",
    variants: [
      {
        issuer: "bStocks",
        symbol: "GOOGLB",
        address: "0x3f53de71c126bdabae20f9cd64848d317f6c3238",
        decimals: 18,
      },
      {
        issuer: "Ondo",
        symbol: "GOOGLon",
        address: "0x091fc7778e6932d4009b087b191d1ee3bac5729a",
        decimals: 18,
      },
      {
        issuer: "xStocks",
        symbol: "GOOGLx",
        address: "0xe92f673ca36c5e2efd2de7628f815f84807e803f",
        decimals: 18,
      },
    ],
  },
  AMZN: {
    name: "Amazon",
    variants: [
      {
        issuer: "bStocks",
        symbol: "AMZNB",
        address: "0x1a4b499833a79a09ad7cf1d42d7dacf71e92eb00",
        decimals: 18,
      },
      {
        issuer: "Ondo",
        symbol: "AMZNon",
        address: "0x4553cfe1c09f37f38b12dc509f676964e392f8fc",
        decimals: 18,
      },
      {
        issuer: "xStocks",
        symbol: "AMZNx",
        address: "0x3557ba345b01efa20a1bddc61f573bfd87195081",
        decimals: 18,
      },
    ],
  },
  META: {
    name: "Meta",
    variants: [
      {
        issuer: "bStocks",
        symbol: "METAB",
        address: "0x7425889fe94f9d693e8daefe88bcced6acfef4c0",
        decimals: 18,
      },
      {
        issuer: "Ondo",
        symbol: "METAon",
        address: "0xd7df5863a3e742f0c767768cdfcb63f09e0422f6",
        decimals: 18,
      },
      {
        issuer: "xStocks",
        symbol: "METAx",
        address: "0x96702be57cd9777f835117a809c7124fe4ec989a",
        decimals: 18,
      },
    ],
  },
  SPY: {
    name: "S&P 500 ETF",
    variants: [
      {
        issuer: "bStocks",
        symbol: "SPYB",
        address: "0x7138b48df7d98d7e3cc221bfe7192d0a178182d8",
        decimals: 18,
      },
      {
        issuer: "Ondo",
        symbol: "SPYon",
        address: "0x6a708ead771238919d85930b5a0f10454e1c331a",
        decimals: 18,
      },
      {
        issuer: "xStocks",
        symbol: "SPYx",
        address: "0x90a2a4c76b5d8c0bc892a69ea28aa775a8f2dd48",
        decimals: 18,
      },
    ],
  },
  QQQ: {
    name: "Nasdaq-100 ETF",
    variants: [
      {
        issuer: "bStocks",
        symbol: "QQQB",
        address: "0x205812cdbed920aff76c6580abd681a46d11efc7",
        decimals: 18,
      },
      {
        issuer: "Ondo",
        symbol: "QQQon",
        address: "0x0cde6936d305d5b34667fc46425e852efd73559a",
        decimals: 18,
      },
      {
        issuer: "xStocks",
        symbol: "QQQx",
        address: "0xa753a7395cae905cd615da0b82a53e0560f250af",
        decimals: 18,
      },
    ],
  },
} as const satisfies Record<string, { name: string; variants: readonly StockVariant[] }>;
// The dollar stablecoin used for buys, sells and payments. BSC USDT has 18 decimals.
export const MAINNET_QUOTE = {
  symbol: "USDT",
  address: "0x55d398326f99059fF775485246999027B3197955",
  decimals: 18,
} as const;
export type MainnetStock = keyof typeof MAINNET_ASSETS;
export const MAINNET_STOCK_SYMBOLS = Object.keys(MAINNET_ASSETS) as [
  MainnetStock,
  ...MainnetStock[],
];
// Every stock token Sharebloom can hold, across tickers and issuers.
export const MAINNET_STOCK_TOKENS = MAINNET_STOCK_SYMBOLS.flatMap((ticker) =>
  MAINNET_ASSETS[ticker].variants.map((v) => ({ ticker, ...v })),
);
export function stockVariantByAddress(address: string) {
  return MAINNET_STOCK_TOKENS.find((v) => v.address.toLowerCase() === address.toLowerCase());
}
// "Apple, NVIDIA, Tesla, ... or Nasdaq-100 ETF" for clarification questions.
export function mainnetStockChoices() {
  const names = MAINNET_STOCK_SYMBOLS.map((s) => MAINNET_ASSETS[s].name);
  return names.slice(0, -1).join(", ") + " or " + names[names.length - 1];
}
// Packed route internals are trusted to Kyber by user choice. Live execution remains
// gated by the environment flag and per-trade checks after funded-wallet preflight.
export const MAINNET_EXECUTION_READY = true;
