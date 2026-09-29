# Architecture

Sharebloom is one Next.js app plus two background workers (WhatsApp and transactions), started together by `scripts/start-production.mjs`. State lives in SQLite on a persistent volume.

## Message flow

1. **Webhook.** `POST /api/whatsapp/webhook` checks Meta's `X-Hub-Signature-256` and stores the message in an encrypted inbox. The request returns immediately.
2. **Guard.** Every SERV request carries the `serv_prompt_guard` tool. A flagged message comes back as a refusal, gets a fixed reply, and no tool runs.
3. **Assistant.** SERV Reasoning receives the conversation and a small set of tools: list stocks, prices, holdings, trade status, the wallet address, contacts, and preparing a trade or a send. None of them can confirm, sign or broadcast.
4. **Review.** A prepared plan is stored, and the user receives an exact review with **Confirm**, **Details** and **Cancel** buttons. The button carries the plan ID and a one-time token.
5. **Runner.** A confirmed plan is leased by the transaction worker, validated again, signed by the user's Privy server wallet and broadcast. The runner waits for the receipt, decodes the Kyber `Swapped` event and replies with a BscScan link.
6. **Outbox.** Every reply goes through a durable outbox, so a crash never loses or duplicates a message.

## Preparing a trade

`prepareMainnetPlan` in `src/server/stocks/mainnet-trade.ts`:

1. Checks the amount (18-decimal USDT, trade cap), the registry (`verifiedMainnetRegistry`) and the chain head freshness.
2. For a sell, keeps only the issuers the wallet holds enough of.
3. Calls `bestMainnetVariant`, which quotes each variant through KyberSwap and rates it with `pickBestVariant` against Binance's per-token price. Outcomes per issuer: `chosen`, `fair`, `unfair_price`, `not_trading`, `no_route` and `no_reference`.
4. Builds the Kyber route for the chosen token only, and decodes the calldata. Router, executor, recipient, tokens, amounts and deadline must all match.
5. Re-reads Binance for that token: it must still be open and the built route must still be within 2%.
6. Estimates gas, sets a fee ceiling and stores the plan with the issuer and the comparison lines shown under **Details**.

## Validation before signing

`validateMainnetPlan` runs again inside the runner, right before signing:

- chain ID 56, and the token must be a configured variant of the requested ticker, with the same issuer as the review;
- the router and executor bytecode hashes must match the pinned values;
- the live Privy policy must contain exactly the generated rules (`validateMainnetPolicyRules`) and nothing else;
- the order must not have expired, and the lease must still be held.

## Privy policy

`mainnetPolicyRules()` generates the policy from the token list, so the code and the policy cannot drift. Each rule pins chain 56, the target contract, zero value and the function name:

- `approve` on USDT and on each of the 27 stock tokens;
- `swap` on the KyberSwap router;
- `transfer` on USDT.

## Failure handling

- **Unknown broadcast outcome.** The runner records the nonce before submitting, refuses to sign while the wallet has a pending transaction, and closes an order that never reached the chain as `not_broadcast` instead of retrying blindly.
- **Gas.** The bid carries 5% headroom over the latest base fee, and the limit comes from an estimate with a margin.
- **Stale data.** Kyber routes older than 2 minutes, Binance prices older than 15 seconds and chain heads older than 2 minutes are refused.
