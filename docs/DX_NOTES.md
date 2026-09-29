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
