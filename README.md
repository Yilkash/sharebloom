<div align="center">

<img src="apps/web/public/images/sharebloom-logo.png" alt="Sharebloom" width="96"/>

# Sharebloom

### Buy tokenized US stocks on BNB Chain by texting on WhatsApp.

Apple, Tesla, NVIDIA, Microsoft, the S&P 500 and more, paid in **USDT**.<br/>
Sharebloom compares **bStocks, Ondo and xStocks** on every trade and only fills at a fair price.<br/>
**Nothing moves until you tap Confirm.**

<br/>

[![Chat on WhatsApp](https://img.shields.io/badge/Chat_on_WhatsApp-+234_903_272_9156-25D366?style=for-the-badge&logo=whatsapp&logoColor=white)](https://wa.me/2349032729156?text=Hi)
[![Website](https://img.shields.io/badge/Website-sharebloom--production.up.railway.app-F0B90B?style=for-the-badge&logo=googlechrome&logoColor=white)](https://sharebloom-production.up.railway.app)

![BNB Chain](https://img.shields.io/badge/BNB_Chain-mainnet_56-F0B90B?style=flat-square)
![Issuers](https://img.shields.io/badge/issuers-bStocks_·_Ondo_·_xStocks-0A84FF?style=flat-square)
![Tokens](https://img.shields.io/badge/stock_tokens-27-2EA043?style=flat-square)
![AI](https://img.shields.io/badge/AI-SERV_Reasoning-6E56CF?style=flat-square)

**BNB Hack · Tokenized Stocks**

</div>

---

## 📱 See it in action

<table>
  <tr>
    <td align="center" width="25%"><img src="apps/web/public/images/whatsapp-prices.jpg" alt="Live Binance prices for all nine stocks" width="200"/></td>
    <td align="center" width="25%"><img src="apps/web/public/images/whatsapp-buy-review.jpg" alt="An Apple buy review where Ondo was the best fair price of three" width="200"/></td>
    <td align="center" width="25%"><img src="apps/web/public/images/whatsapp-sell-review.jpg" alt="A misspelled sell request understood and reviewed" width="200"/></td>
    <td align="center" width="25%"><img src="apps/web/public/images/whatsapp-sell-receipt.jpg" alt="A completed sell with a BscScan link" width="200"/></td>
  </tr>
  <tr>
    <td align="center"><b>Live prices</b><br/>Binance reference prices for all nine stocks</td>
    <td align="center"><b>Best of three</b><br/>Ondo gave the most Apple this time</td>
    <td align="center"><b>Plain language</b><br/>"Sell 0.003 appl shares" understood</td>
    <td align="center"><b>Real receipt</b><br/>Settled on BNB Chain with a BscScan link</td>
  </tr>
</table>

### 🔗 Real trades on BNB Chain

| Trade                            | Issuer chosen   | Transaction                                                                                                      |
| -------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------- |
| Bought Apple with 1 USDT         | bStocks (AAPLB) | [`0xcb3b688d…749b98`](https://bscscan.com/tx/0xcb3b688dfc80bc9ee262243c169788831b6dc683107ee3df63f127433f749b98) |
| Bought Apple with 1 USDT         | Ondo (AAPLon)   | [`0x03842758…e2c489`](https://bscscan.com/tx/0x03842758956980f230449537deb341695ebf898803ad66501bae69d867e2c489) |
| Sold 0.003 Apple for 1.0098 USDT | bStocks (AAPLB) | [`0xa0eb0b1c…d51fdc`](https://bscscan.com/tx/0xa0eb0b1ca8dc4be933e320704a6a3f732e29258464ab7fcc77e38bebb9d51fdc) |

The same message bought Apple from two different issuers a few minutes apart, because the fairest price moved.

## 💡 The problem

Every popular US stock on BNB Chain exists as **three different tokens**, one per issuer, each with its own liquidity:

| Stock   | bStocks | Ondo     | xStocks |
| ------- | ------- | -------- | ------- |
| Apple   | `AAPLB` | `AAPLon` | `AAPLx` |
| Tesla   | `TSLAB` | `TSLAon` | `TSLAx` |
| S&P 500 | `SPYB`  | `SPYon`  | `SPYx`  |

A new user can't tell which one to buy, and the wrong pick is expensive. On **29 September 2026**, a live 1 USDT Apple buy quoted:

| Token    | Issuer  | Apple received | Against Binance's price |
| -------- | ------- | -------------- | ----------------------- |
| `AAPLB`  | bStocks | 0.002965       | ✅ **fair, best**       |
| `AAPLon` | Ondo    | 0.002936       | ✅ fair                 |
| `AAPLx`  | xStocks | 0.000483       | ❌ **509% above fair**  |

Buying the "wrong Apple" would have cost six times the fair price. It was the same for the S&P 500 (`SPYx` 863% above fair) and Microsoft (`MSFTx` 623% above fair).

On top of that, most people who want to own Apple don't want to learn about wallets, seed phrases, DEXs, slippage or token addresses.

## ✨ The solution

Sharebloom turns all of that into a WhatsApp chat:

```text
You:        Buy Apple with 5 USDT

Sharebloom: Buy Apple (AAPL)
            BNB Chain
            Issuer: bStocks (AAPLB) · best fair price of 3

            Pay: 5 USDT
            Receive: ≈ 0.01482 AAPLB
            Minimum: 0.01474 AAPLB
            Network fee: up to 0.00004 BNB
            Expires: 14:32 UTC

            [ Confirm buy ]  [ Details ]  [ Cancel ]

You:        Confirm buy

Sharebloom: Trade complete ✅  https://bscscan.com/tx/0x…
```

Behind that one message, Sharebloom:

1. **Understands** the request with SERV Reasoning, behind a prompt-injection guard.
2. **Quotes all three issuers** through KyberSwap on BNB Chain.
3. **Checks each quote** against Binance's reference price for that exact token, and skips tokens Binance marks as not trading.
4. **Rejects** any quote more than **2% worse** than fair, and picks the one that gives you the most.
5. **Shows an exact review** and waits for your tap. The AI has no tool that can confirm or send.
6. **Executes** from your own Privy server wallet, whose policy only allows these 27 tokens, USDT and the KyberSwap router.

## 💬 Things you can say

### 📈 Stocks

```text
Buy Apple with 5 USDT
What would 10 USDT get me in Tesla?
Buy the S&P 500 with 20 USDT
Sell 0.01 NVIDIA
```

### 📊 Prices, companies and holdings

```text
What are the prices?
Tell me about Apple
How did Tesla do this week?
Show my stocks
What stocks can I buy?
```

### 💸 Wallet

```text
How do I add money?
Send 5 USDT to 0x…
```

**Supported:** AAPL, TSLA, NVDA, MSFT, GOOGL, AMZN, META, SPY and QQQ, each from three issuers (27 tokens).

## ⚖️ How fair-price routing works

```mermaid
flowchart LR
    U[Buy Apple, 5 USDT] --> Q1[Kyber quote AAPLB]
    U --> Q2[Kyber quote AAPLon]
    U --> Q3[Kyber quote AAPLx]
    Q1 & Q2 & Q3 --> R{Binance price and<br/>trading status<br/>per token}
    R -->|within 2%| F[Fair candidates]
    R -->|over 2% worse<br/>or paused| X[Rejected]
    F --> B[Most value for the user]
    B --> C[Build route and<br/>re-check before review]
```

- **Reference price.** Binance Web3 API **RWA Data** (`/rwa/price`): one batched call returns Binance's reference price for all three issuers. xStocks are not covered there, so they are held to the bStocks reference for the same 1:1 share. Trading status (`openState`) comes from Binance's public RWA data, which is also the fallback for prices. Prices become 18-decimal integers; floating point is never used for money.
- **Deviation.** The quote's effective price against the reference, always measured _against the user_: for a buy, paying more is worse, and for a sell, receiving less is worse. It rounds up, so 2.001% counts as more than 2%.
- **Sells** compare only the issuers you hold enough of.
- **Double check.** The chosen route is rebuilt with calldata and checked again, with a fresh trading status, before you see the review.
- **Registry pinning.** Every configured token is checked against Binance's RWA list (chain 56, address, ticker, symbol and decimals), and `symbol()` and `decimals()` are re-read on-chain. If anything changes, trading stops.

The code is in [`stock-routing.ts`](apps/web/src/server/stocks/stock-routing.ts) and [`binance-rwa.ts`](apps/web/src/server/stocks/binance-rwa.ts). The tests in [`stock-routing.test.ts`](apps/web/tests/stock-routing.test.ts) replay the live Apple observations above.

## 🛡️ Built so the AI can't move your money

| Guard                   | How                                                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| The AI can't send       | SERV only gets read and prepare tools. Confirmation is a WhatsApp button handled by code.                                              |
| Prompt-injection guard  | Every SERV request runs `serv_prompt_guard`; a flagged message is refused before any tool runs.                                        |
| Fair price or nothing   | A quote more than 2% worse than Binance's price for that token is rejected.                                                            |
| Wallet policy           | The Privy policy allows only USDT or stock-token `approve`, KyberSwap `swap` and USDT `transfer`, all on chain 56 with zero BNB value. |
| Pinned router           | The KyberSwap router and executor are pinned by bytecode hash; calldata is decoded and matched to the review.                          |
| Exact, expiring reviews | Minimum received and maximum fee are shown. A review expires after 4 minutes and confirms once.                                        |
| Trade cap               | `MAINNET_MAX_USDT_PER_TRADE` limits each trade, up to a hard ceiling of 1,000 USDT.                                                    |
| Welcome gas top-up      | One 0.0002 BNB top-up per new wallet holding USDT, from a wallet whose Privy policy caps each send at 0.0002 BNB, with a daily limit.  |
| Unknown outcomes        | A durable runner reconciles every broadcast by its receipt and never retries a trade blindly.                                          |

## 🏗️ Architecture

```mermaid
flowchart LR
    WA[WhatsApp Cloud API] -->|signed webhook| IN[(Encrypted inbox)]
    IN --> AS[Assistant]
    AS <-->|prompt guard + tools| SERV[SERV Reasoning]
    AS --> ROUTE[Fair-price routing]
    ROUTE <--> BIN[Binance RWA data]
    ROUTE <--> KY[KyberSwap on BSC]
    ROUTE --> REV[Exact review]
    REV -->|user taps Confirm| RUN[Durable runner]
    RUN --> PRIVY[Privy wallet + policy]
    PRIVY --> BSC[(BNB Chain)]
    BSC --> RUN
    RUN --> OUT[(Outbox)] --> WA
```

| Part        | Technology                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| App and API | Next.js 16 · TypeScript · viem · zod                                                                                                        |
| AI          | SERV Reasoning with tool calling and `serv_prompt_guard`                                                                                    |
| Market data | Binance Web3 API: RWA Data (reference prices, company facts) and Market (24h change, daily candles); public RWA token list for the registry |
| Trading     | KyberSwap aggregator on BNB Chain                                                                                                           |
| Wallets     | Privy server wallets with a generated allow-list policy                                                                                     |
| Messaging   | WhatsApp Cloud API: signed webhooks, list menus and reply buttons                                                                           |
| Storage     | SQLite (`node:sqlite`) on a persistent volume, sensitive fields encrypted                                                                   |
| Hosting     | Docker on Railway, with the web app and workers in one service                                                                              |

```text
sharebloom/
├── apps/web/
│   ├── src/server/networks/chain.ts   # BNB Chain, USDT and the 27 stock tokens
│   ├── src/server/stocks/             # Binance data, routing, Kyber, policy, runner
│   ├── src/server/whatsapp/           # Assistant, menus, consent, wallet onboarding
│   ├── src/app/                       # Landing page, webhook, privacy pages
│   ├── scripts/                       # Policy creation and setup checks
│   └── tests/                         # Node test suite
├── contracts/                         # Legacy demo contracts (not used on BNB Chain)
└── deploy/                            # Docker Compose + Caddy example
```

## 🛠️ Run it yourself

**Requirements:** Node.js 24+, plus credentials for SERV, Privy and a Meta WhatsApp Business number.

```bash
git clone https://github.com/Yilkash/sharebloom.git
cd sharebloom/apps/web
npm ci
cp .env.example .env.local   # add your own keys; never commit this file
```

```bash
npm run dev                  # website at http://localhost:3000
npm run whatsapp:worker      # WhatsApp and transaction workers
```

Generate the wallet policy from the token list, create it, then verify the setup:

```bash
node --env-file=.env.local --import tsx scripts/mainnet-setup.ts --policy-template
node --env-file=.env.local --import tsx scripts/mainnet-policy-create.ts
node --env-file=.env.local --import tsx scripts/mainnet-verify-setup.ts
```

See [`docs/SETUP.md`](docs/SETUP.md) for every environment variable.

### ✅ Checks

```bash
npm run format:check
npm run typecheck
npm test          # 80 tests
npm run build
```

## ⚠️ Limitations

- Stock tokens track the underlying share price. They are not direct share ownership, and each issuer has its own terms.
- Users need a little BNB for gas. New users get a one-time 0.0002 BNB welcome top-up (about 6 trades) once they hold USDT; after that they add their own.
- The 2% fairness band is one fixed setting, not tuned per stock.
- Binance's reference price is the source of truth. If it is unavailable, Sharebloom refuses to trade rather than guess.

## 📚 More

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): the trade lifecycle and safety design
- [`docs/SETUP.md`](docs/SETUP.md): environment variables and deployment
- [`docs/DX_NOTES.md`](docs/DX_NOTES.md): a build log of integration friction on BNB Chain

<div align="center">

**Sharebloom by Steward Pay** · Stock tokens are BNB Chain tokens, not direct share ownership.

</div>
