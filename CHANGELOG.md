# Changelog

## 2026-09-29 — Sharebloom on BNB Chain

### Added

- WhatsApp trading of 27 tokenized stock tokens on BNB Chain (9 tickers × bStocks, Ondo, xStocks), paid in USDT.
- Fair-price routing: every issuer is quoted through KyberSwap and checked against Binance's per-token reference price and trading status; quotes more than 2% worse are rejected.
- Runtime registry check against Binance's RWA token list.
- Privy policy generated from the token list.
- Sharebloom landing page, icons and legal pages.

### Removed

- Robinhood Chain mainnet trading, LI.FI fallback and Steward rollout scripts.

## 2026-09-22 — Initial implementation and organization

### Added

- Wallet sign-in, contacts, token/ETH balances and receive QR.
- Manual payment drafts, SERV tools, wallet approval, receipt checks and hash recovery.
- Persistent SQLite records and a test-only faucet token.
- Setup, architecture and contribution guides.

### Organized

- Moved the web app to apps/web and contract code to contracts.
- Grouped current research and plans under docs; archived the superseded portfolio plan.
- Split the interface into seven components and a state/action hook.
- Split request handling into HTTP helpers, authentication and feature handlers.
- Separated browser/shared code from server code.
- Added repeatable formatting and removed generated Counter boilerplate.
- Kept shared Foundry dependencies at the repository root.

### Pending

- Live testnet token deployment and a complete wallet-to-wallet transfer.
- An authenticated SERV request and hackathon eligibility clarification.
- Behavioral tests and complete cancellation/replacement recovery.

Compilation checkpoint: `npm run build` passes (including TypeScript); `forge build --skip test` passes from the contracts directory. No tests were run during this reorganization.

## 2026-09-22 — Browser wallet deployment

- Added a testnet deployment page with wallet connection, estimated fees and explicit wallet approval.
- Added a reproducible token bytecode export and receipt/code verification.
- Added recovery for a submitted deployment hash. No deployment has been broadcast by the assistant.

## 2026-09-22 — Testnet token configured

- User deployed Demo USD at `0x13800afeea6f8688547770052b395099758d9a5b` on chain 46630.
- Read-only RPC checks confirmed the runtime bytecode, name, symbol and six decimals.
- Configured the local web app with the verified token address. Faucet claim, end-to-end transfer and authenticated SERV call remain pending.

## 2026-09-22 — First transfer and authenticated SERV balance call

- Verified a 5 DUSD transfer on testnet in transaction `0x8df33f824e50dccc49d204874205418a3b85a15581dce387756fbecc11f570cd`, block 122765407. Transaction fields and Transfer event matched the app payment; balances at inclusion were 995 DUSD for the sender and 5 for the recipient.
- Successfully authenticated to SERV with the local key and configured model. SERV requested get_balances and then returned the onchain balance of 995 DUSD and 0.00999217189 test ETH (block 122766949).
- The running app reports SERV configured. This check exercised the SERV API/tool exchange directly; the full browser chat-to-payment approval flow remains to be demonstrated.

## 2026-09-22 — Payment status in chat

- Linked new assistant drafts to payment IDs in persistent chat records, with an additive SQLite migration.
- Existing messages containing a draft ID also display current payment status, replacing stale draft instructions after submission.
- Resolve saved contact names by address for new drafts and previously unnamed payment records; recipient addresses remain unchanged.
- Production build passes. Browser behavior and recovery scenarios still require verification.

## 2026-09-22 — Wallet-session reliability

- Ignore repeated account/network events when the wallet is unchanged; reuse valid signed sessions on reconnect.
- Guard session restoration, stale balance/history responses, and rapid duplicate action clicks.
- Recognize wallet rejection through nested provider errors while preserving unknown outcomes.
- Passed 10 backend tests, 8 browser regressions and 4 contract tests (including 256 fuzz runs). Production compilation passed.
- Added test commands and CI coverage. See docs/RELIABILITY.md for isolation, coverage and remaining limits.

## 2026-09-22 — Replacement recovery and hosting package

- Accept matching speed-ups and canonical same-sender/same-nonce cancellations or replacements; retain previous transaction hashes.
- Keep pending or unverified replacements blocked; never infer cancellation from a timeout. Refresh can move a disappeared receipt back to unknown.
- Expose replacement-hash recovery for submitted payments and show cancelled/replaced states in chat.
- Added 8 backend recovery subtests; backend runner reports 19 passing tests and all 8 browser regressions pass. Production build passes.
- Added a validated non-root Docker image, persistent-volume HTTPS deployment configuration, and demo runbook. Local container startup and restart persistence checks passed. Public hosting awaits provider and domain details.

## 2026-09-26 — SERV prompt guard

- Declared SERV's `serv_prompt_guard` on the WhatsApp assistant request and the web payment chat. SERV checks user input for prompt injection before the model runs.
- Refusals arrive as HTTP 200 content-filter responses. They now produce a fixed "can't help, no payment was sent" reply, are never shown as a model answer, and are not saved to chat history. The WhatsApp wording pass discards refused output.
- Live check with the production prompt and tools: five normal requests chose the same tool with and without the guard; two injection attempts were blocked. The guard added about 3 seconds per assistant message.
- Added 5 tests; the suite reports 91 passing. TypeScript and production build pass. Deployed to Railway as 90fd3819-1baa-476d-879e-7ef6c2827f53.

## 2026-09-26 — Stock trade gas check

- A confirmed 0.001 AAPL sell stopped after its approval was mined: the swap's fresh gas estimate exceeded the reviewed gas units. The reviewed swap gas is the provider's estimate plus 25%, and Kyber's estimate ran low (a later check measured 313,835 by RPC vs 287,581 from Kyber; Arbitrum L1 data cost was only ~300 gas).
- The runner now enforces the maximum network fee the user confirmed for each step (reviewed gas x reviewed price ceiling) instead of the gas-unit count. A higher estimate is sent with a 10% margin only if that limit at the actual gas price still fits the confirmed fee; otherwise the step stops as before. Price ceiling, balance, simulation and all other checks are unchanged.
- Added 5 tests; suite reports 96 passing. TypeScript and production build pass. Deployed to Railway as 90fd3819-1baa-476d-879e-7ef6c2827f53. The earlier order left an exact 0.001 AAPL allowance to the Kyber router; the next review resets and re-approves it.

## 2026-09-26 — Close mainnet steps that were never broadcast

- Order 965c626f blocked every new payment and trade for its account. Its first step was marked submitting with nonce 7, the Privy send errored without a hash, and reconciliation required exactly one Privy record with a hash, so the order stayed unknown forever. The wallet's latest and pending nonces were still 7: nothing reached the chain.
- The runner now closes such a step as failed (`not_broadcast`) only when Privy has no record or only a failed/provider_error record without a hash, the order expired more than 2 minutes ago (the Privy request never outlives the order), and the wallet's latest and pending nonces both still equal the step's nonce. The user is told nothing was sent. Any other case stays unknown for review.
- Logs now record why an order step stopped and what the Privy reference lookup returned, without secrets.
- Added 5 tests; suite reports 101 passing. TypeScript and production build pass.

## 2026-09-28 — Six more stocks and ETFs

- Added MSFT, GOOGL, AMZN, META, SPY and QQQ to the mainnet catalogue (9 total), verified against the Robinhood registry, Chainlink feeds and live KyberSwap quotes. See docs/STOCK_EXPANSION.md.
- One stock list now drives tool schemas, clarification prompts, assistant instructions, name matching (Google, Facebook, S&P 500, Nasdaq and so on) and fact checks on reworded replies.
- The Privy policy validator keeps the original rules required and accepts added-stock approve rules as optional; selling an added stock requires its rule. New `scripts/mainnet-enable-stocks.ts` adds the rules (read-only by default, `--apply` to add).
- Holdings replies list only stocks the user holds. The landing page shows the catalogue size.
- Added 8 tests; suite reports 109 passing.

## 2026-09-29 — Broadcast gas bid headroom

- A confirmed MSFT sell was rejected by Privy with "max fee per gas less than block base fee" (bid 20,132,000 wei vs base fee 20,138,000). The runner bid exactly the base fee it had just read, which rose before broadcast. Nothing reached the chain; the order closed as `not_broadcast`.
- The runner now bids 5% above the higher of the RPC suggestion and base fee, capped at the confirmed price ceiling. The gas-limit check still bounds the worst-case fee by the confirmed maximum at that bid. On Arbitrum chains the sender pays the block base fee, not the bid.
- Added 3 tests; suite reports 112 passing.
