# Setup

## Services you need

| Service                 | What for                                                     |
| ----------------------- | ------------------------------------------------------------ |
| SERV (OpenServ)         | Intent understanding and the prompt guard                    |
| Privy                   | Server wallets and the wallet policy                         |
| Meta WhatsApp Cloud API | A WhatsApp Business number, app secret and system-user token |
| Railway (or any Docker) | Hosting with a persistent volume at `/app/.data`             |

KyberSwap and Binance RWA data are public and need no key.

## Environment variables

Copy `apps/web/.env.example` to `.env.local` for local runs, or set these on the host.

| Variable                                 | Value                                                             |
| ---------------------------------------- | ----------------------------------------------------------------- |
| `APP_ORIGIN`                             | Public URL, for example `https://sharebloom.up.railway.app`       |
| `SERV_API_KEY`                           | SERV key                                                          |
| `WHATSAPP_ENABLED`                       | `true`                                                            |
| `WHATSAPP_PHONE_NUMBER_ID`               | From WhatsApp Manager                                             |
| `WHATSAPP_WABA_ID`                       | The WhatsApp Business Account ID                                  |
| `WHATSAPP_APP_SECRET`                    | The Meta app secret, for webhook signatures                       |
| `WHATSAPP_VERIFY_TOKEN`                  | Any random string; the same value goes in Meta's webhook settings |
| `WHATSAPP_ACCESS_TOKEN`                  | The system-user token                                             |
| `WHATSAPP_DATA_KEY`                      | 64 hex characters (`openssl rand -hex 32`); never change it later |
| `WHATSAPP_ACCESS_MODE`                   | `allowlist` while testing, `public` for launch                    |
| `WHATSAPP_ALLOWED_SENDERS`               | Comma-separated numbers, needed in allowlist mode                 |
| `PRIVY_APP_ID`, `PRIVY_APP_SECRET`       | From the Privy dashboard                                          |
| `PRIVY_WALLET_OWNER_ID`                  | The authorization key that owns user wallets                      |
| `PRIVY_WALLET_CREATION_ENABLED`          | `false` (this turns off the legacy testnet wallets only)          |
| `MAINNET_STOCK_TRADING_ENABLED`          | `true` once the policy is created and verified                    |
| `MAINNET_KYBER_EXECUTOR`, `..._CODEHASH` | Keep the BNB Chain values in `.env.example`                       |
| `MAINNET_ROUTER_CODEHASH`                | Keep the BNB Chain value in `.env.example`                        |
| `PRIVY_MAINNET_POLICY_ID`                | Printed by `scripts/mainnet-policy-create.ts`                     |
| `MAINNET_MAX_USDT_PER_TRADE`             | For example `50` (maximum `1000`)                                 |
| `MAINNET_MAX_FEE_WEI`                    | Optional fee ceiling per trade                                    |

## Welcome BNB top-up (optional)

New users need a little BNB for network fees. Sharebloom can send each new wallet one
top-up of 0.0002 BNB (about 6 trades) from a Sharebloom-funded wallet, the first time a
review fails only for lack of BNB and the wallet holds at least 1 USDT.

1. Create the top-up wallet. Its Privy policy only allows sending up to 0.0002 BNB per
   transaction on chain 56:
   ```bash
   railway run npx tsx scripts/gas-wallet-create.ts
   ```
2. Set the two values it prints, `GAS_TOPUP_WALLET_ID` and `GAS_TOPUP_WALLET_ADDRESS`.
3. Fund the address with BNB on BNB Smart Chain (BEP20). 0.004 BNB covers 20 users.

| Variable                | Value                                             |
| ----------------------- | ------------------------------------------------- |
| `GAS_TOPUP_WEI`         | Top-up per user in wei, at most `200000000000000` |
| `GAS_TOPUP_DAILY_LIMIT` | Top-ups per 24 hours, default `10`                |

Each account and wallet gets one top-up ever. The logs warn when the top-up wallet drops
below 0.003 BNB.

## First deployment

1. **Deploy** the Docker image from `apps/web` with a volume mounted at `/app/.data`.
2. **Create the wallet policy**, then set `PRIVY_MAINNET_POLICY_ID` and redeploy:
   ```bash
   node --env-file=.env.local --import tsx scripts/mainnet-policy-create.ts
   ```
3. **Verify** the pins, the policy and the token list:
   ```bash
   node --env-file=.env.local --import tsx scripts/mainnet-verify-setup.ts
   ```
4. **Connect WhatsApp.** In the Meta app, set the webhook callback URL to `https://<your-host>/api/whatsapp/webhook`, use your `WHATSAPP_VERIFY_TOKEN`, and subscribe to `messages`. Subscribe the app to your WABA. Publish the app so real users' messages arrive, not only test webhooks.
5. **Fund a test wallet.** Text the number, create an account, ask for your address, and send it a little **USDT (BEP-20)** and about **0.002 BNB** for gas on BNB Chain.
6. **Test trade.** `Buy Apple with 1 USDT`, check the review and the Details, confirm, and open the BscScan link.
