# Build log: integration friction on BNB Chain

Raw notes kept while porting Steward (Robinhood Chain) to Sharebloom (BNB Chain), 28–29 September 2026. These are facts from the build, to help write the Developer Experience Report.

## Binance RWA data

- **Finding the docs.** The Web3 developer pages returned an empty response to non-browser clients. The usable reference for the tokenized-stock endpoints was the `binance/binance-skills-hub` GitHub repo (`binance-tokenized-securities-info`).
- **Required headers.** Requests need `Accept-Encoding: identity` and a `User-Agent`, as in the skills hub examples. Without them, responses were unreliable.
- **Regional DNS.** From Nigeria, the ISP resolver did not resolve Binance domains. Local testing needed a public resolver (1.1.1.1). The hosted service in the cloud was fine.
- **Precision.** Prices come as decimal strings with 30+ significant digits. We parse them straight into 18-decimal integers; `Number()` would have lost precision.
- **What helped.** One public call returns every stock token with chain ID, contract, ticker, symbol and decimals, so our registry is checked against Binance at runtime. The per-token price includes a trading status (`openState`), which let us refuse trades on paused tokens.

## Three issuers per stock

- Each ticker has three tokens (bStocks `B`, Ondo `on`, xStocks `x`) with very different liquidity. On 29 September 2026, 1 USDT of AAPLx quoted about 509% above fair; SPYx about 863%, MSFTx about 623%. The same Apple buy through AAPLB was fair.
- There is no single "Apple on BNB Chain" address. A naive app that picks one token by name can give users terrible fills, so we quote all three and compare each to its own reference price.

## USDT decimals

- USDT on BNB Chain has **18 decimals**, unlike USDG and USDC elsewhere (6). The port found four separate 6-decimal assumptions: payment review formatting, the affordability check, the buy amount parser and a send-amount regex. Tests now use 18-decimal values.

## KyberSwap on BSC

- The router and executor addresses are the same as on other chains, but the **executor bytecode differs**, so bytecode pins are per-chain. Reusing another chain's pins fails closed.
- Public routes needed no key; we send a client ID header.

## Gas

- Wallets need BNB for gas even when trading USDT only. This is the main onboarding friction for non-crypto users.
- On the previous chain, broadcasts failed with "max fee per gas less than block base fee" until we added 5% headroom. The same logic carries over.

## Tooling

- viem has BNB Chain built in, and chain 56 swaps were a matter of changing constants and pins; most work was in routing and decimals.
- Privy policies worked unchanged on chain 56. Generating the policy from the token list kept 30 rules consistent with the code.

## Binance Web3 Wallet API (keyed), first probe on 1 October 2026

Facts from `scripts/binance-web3-probe.ts`, run against `https://web3.binance.com/build`.

- **Signing.** HMAC-SHA256 over `timestamp + METHOD + "/build" + path + "?query" + body`,
  base64, in `X-OC-*` headers. Found by reading the official Python connector's
  `binance-common` package, because the developer docs site did not load from Nigeria.
- **`POST /market/price-info` body is undocumented in both official connectors.** The
  Python and JavaScript clients send an empty body. Results:
  - no body: `40001 Invalid request body: malformed JSON or field type mismatch`;
  - object body `{binanceChainId, tokenContractAddresses: [...]}`: `50000 Internal server
error, please retry later` (a server error for a client mistake);
  - array body `[{"binanceChainId":"56","tokenContractAddress":"0x…"}]`: works.
- **The RWA token list (`/market/rwa/tokens?binanceChainId=56`) returned 488 rows but only
  AAPLon of the three Apple tokens.** AAPLB and AAPLx were missing, though `/rwa/price`
  returned all three.
- **xStocks data looks stale.** AAPLx came back with `platformId: null` and a
  `tokenPriceUpdatedAt` about 2.5 days old, with `tokenPrice` equal to `referencePrice`.
- **Rate limit:** `x-oc-ratelimit-limit: 5`, with remaining and used weight in headers.
- **Latency:** the token list took 2.0 s (about 454 KB); other calls 0.43–1.3 s.
- **What worked well:** batch `/rwa/price` for three tokens in one call; `/rwa/underlying-market`
  gives 52-week range, P/E, market cap and dividend yield; daily candles; the aggregated
  quote routed 1 USDT to 0.002984 AAPLB through Uniswap V4 via the vendor LiquidMesh.
- **Token list filters (second probe).** `platformId=bstock` returned 46 rows without
  AAPLB; `platformId=xstock` returned `40001 Platform not found: xstock`; `tabId` 1, 2 and 3
  all returned the same 488 rows. The keyed list therefore cannot verify our 27 tokens, so
  the registry check stays on the public list while prices use the keyed `/rwa/price`.
- **Region restriction in production.** From Railway's US region every keyed call returned
  HTTP 200 with `40304 Service not available due to compliance restriction`, while the
  same key worked from Nigeria. Nothing in the error says which regions are allowed; the
  hackathon Telegram group said to use Asia (Singapore). Retrying per stock after the
  batch failed then produced `429 / 42900 Rate limit exceeded`.
- **RFQ quotes need a wallet.** `/aggregator/quote` for AAPLon returned `40001
userWalletAddress is required for RFQ (Ondo) quote`. The connectors mark
  `userWalletAddress` optional; only its description says it is required for equity/RWA
  tokens. With it, the quote is a read-only best-execution check. On 1 October, 1 USDT to
  AAPLB: KyberSwap 0.0030023, Binance 0.0030030 via LiquidMesh (Uniswap V4).
- **Ondo RFQ minimum.** With the wallet added, AAPLon quotes for 1 USDT return `40375
Minimum order amount is 5 USD.` Below $5 the Binance check is skipped for Ondo; KyberSwap
  still routes the trade. On 1 October, 1 USDT to AAPLB: KyberSwap 0.0030036, Binance
  0.0030053 via LiquidMesh (Metric), 0.06% apart.
