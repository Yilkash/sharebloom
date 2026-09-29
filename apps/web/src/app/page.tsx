import {
  ArrowUpRight,
  BadgeCheck,
  Bot,
  Github,
  Lock,
  MessageCircle,
  Route,
  ShieldCheck,
  Timer,
  Wallet,
} from "lucide-react";
import { publicStats } from "@/server/public-stats";
import { MAINNET_STOCK_SYMBOLS } from "@/server/networks/chain";
import styles from "./landing.module.css";

export const dynamic = "force-dynamic";

const WHATSAPP = "https://wa.me/2348051064171?text=Hi";
const GITHUB = "https://github.com/Yilkash/steward";
const tx = (hash: string) => `https://robinhoodchain.blockscout.com/tx/${hash}`;

const examples = [
  "Buy AAPL with 0.5 USDG",
  "What would 1 USDG get me in Tesla?",
  "Sell 0.001 Apple shares",
  "Show my mainnet stocks",
  "Send 5 USDG to Ada",
  "Buy SPY with 2 USDG",
  "Buy Microsoft with 1 USDG",
  "What are the prices?",
];

const steps = [
  {
    icon: MessageCircle,
    title: "Text what you want",
    body: "Plain language in WhatsApp. No app to install, no seed phrase to write down.",
  },
  {
    icon: Bot,
    title: "AI finds the action",
    body: "SERV Reasoning picks the right tool, with a prompt-injection guard on every message.",
  },
  {
    icon: Route,
    title: "Code checks the trade",
    body: "Best route via KyberSwap or LI.FI. Contracts, amounts, minimum output and fees are verified in code.",
  },
  {
    icon: BadgeCheck,
    title: "You tap Confirm",
    body: "The trade settles on Robinhood Chain and you get a receipt with an explorer link.",
  },
];

const safety = [
  {
    icon: Lock,
    title: "The AI never holds keys",
    body: "No tool can confirm or submit a transaction. Only your button press can.",
  },
  {
    icon: Wallet,
    title: "Your own wallet",
    body: "Each user gets a Privy wallet whose policy only allows approved contracts and functions.",
  },
  {
    icon: ShieldCheck,
    title: "Exact reviews",
    body: "Every review shows what you pay, what you get, the minimum and the maximum network fee.",
  },
  {
    icon: Timer,
    title: "Single-use, expiring",
    body: "Reviews expire after 4 minutes and each Confirm button works once.",
  },
];

const proof = [
  {
    label: "Buy AAPL with 0.5 USDG",
    hash: "0x6f92e708761a6a7da54315908a31d9dcf814fde569c58b4f5b1867bb9640af0c",
  },
  {
    label: "Buy AAPL with 0.5 USDG",
    hash: "0x5091fac8af4ae6a7165664b95f32b7127557fee6b57ef5144e26210f285ad8d9",
  },
  {
    label: "Buy AAPL",
    hash: "0x9a875b3943b63bd02ab79808ed1bb27b9e75720a7836b0f46bce4c81e374e091",
  },
];

export default function Landing() {
  const stats = publicStats();
  return (
    <div className={styles.page}>
      <header className={styles.nav}>
        <a className={styles.brand} href="/">
          <img className={styles.brandLogo} src="/images/steward-logo.png" alt="" />
          <span>
            steward<span className={styles.dot}>.</span>
          </span>
        </a>
        <nav className={styles.links} aria-label="Sections">
          <a href="#how">How it works</a>
          <a href="#safety">Safety</a>
          <a href="#proof">Proof</a>
          <a href={GITHUB}>GitHub</a>
        </nav>
        <a className={styles.navCta} href={WHATSAPP}>
          <MessageCircle size={16} /> Chat now
        </a>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <div className={styles.heroText}>
            <p className={styles.eyebrow}>Live on Robinhood Chain mainnet</p>
            <h1>
              Buy stocks by <span className={styles.highlight}>texting</span> on WhatsApp.
            </h1>
            <p className={styles.lead}>
              Trade Apple, Tesla, NVIDIA, the S&P 500 and more with USDG, just by chatting. Steward
              shows you the exact deal, and nothing moves until you tap Confirm.
            </p>
            <div className={styles.ctas}>
              <a className={styles.primary} href={WHATSAPP}>
                <MessageCircle size={18} /> Start on WhatsApp
              </a>
              <a className={styles.secondary} href="#proof">
                See real trades <ArrowUpRight size={16} />
              </a>
            </div>
            <div className={styles.chat} aria-label="Example conversation">
              <p className={styles.me}>Buy AAPL with 0.5 USDG</p>
              <p className={styles.bot}>
                Pay 0.5 USDG · Receive ≈ 0.00147 AAPL
                <br />
                <b>[ Confirm buy ]</b>
              </p>
              <p className={styles.bot}>Trade complete ✅</p>
            </div>
          </div>
          <div className={styles.phones}>
            <img
              src="/images/whatsapp-sell-review.jpg"
              alt="Steward in WhatsApp showing an exact review to sell 0.001 AAPL"
              className={styles.phoneBack}
            />
            <img
              src="/images/whatsapp-buy-receipt.jpg"
              alt="Steward in WhatsApp confirming an AAPL buy with an explorer link"
              className={styles.phoneFront}
            />
          </div>
        </section>

        <section className={styles.stats} aria-label="Steward at a glance">
          {stats && (
            <>
              <div>
                <b>{stats.users}</b>
                <span>users with their own wallet</span>
              </div>
              <div>
                <b>{stats.confirmed}</b>
                <span>confirmed mainnet trades and payments</span>
              </div>
            </>
          )}
          <div>
            <b>{MAINNET_STOCK_SYMBOLS.length}</b>
            <span>stocks and ETFs, from Apple to the S&amp;P 500</span>
          </div>
          <div>
            <b>24/7</b>
            <span>trading, settled in seconds</span>
          </div>
        </section>

        <section className={styles.section}>
          <p className={styles.eyebrow}>Just say it</p>
          <h2>Things you can text Steward</h2>
          <div className={styles.examples}>
            {examples.map((text) => (
              <code key={text}>{text}</code>
            ))}
          </div>
        </section>

        <section id="how" className={styles.section}>
          <p className={styles.eyebrow}>How it works</p>
          <h2>AI suggests. Code verifies. You confirm.</h2>
          <div className={styles.grid4}>
            {steps.map(({ icon: Icon, title, body }, index) => (
              <article key={title} className={styles.card}>
                <span className={styles.stepNo}>{index + 1}</span>
                <Icon size={22} />
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="safety" className={`${styles.section} ${styles.dark}`}>
          <p className={styles.eyebrow}>Built so the AI can’t move your money</p>
          <h2>Safety is the product.</h2>
          <div className={styles.grid4}>
            {safety.map(({ icon: Icon, title, body }) => (
              <article key={title} className={styles.darkCard}>
                <Icon size={22} />
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="proof" className={styles.section}>
          <p className={styles.eyebrow}>Don’t trust us, check the chain</p>
          <h2>Real trades on Robinhood Chain</h2>
          <ul className={styles.proof}>
            {proof.map(({ label, hash }) => (
              <li key={hash}>
                <span>{label}</span>
                <a href={tx(hash)}>
                  <code>
                    {hash.slice(0, 10)}…{hash.slice(-6)}
                  </code>
                  <ArrowUpRight size={15} />
                </a>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.final}>
          <h2>Your first stock is one message away.</h2>
          <p>Say hi, create your account, fund it with a little USDG and ETH, and start trading.</p>
          <a className={styles.primary} href={WHATSAPP}>
            <MessageCircle size={18} /> Chat with Steward
          </a>
        </section>
      </main>

      <footer className={styles.footer}>
        <span>
          Steward · Powered by SERV Reasoning · Stock tokens are Robinhood Chain tokens, not direct
          share ownership.
        </span>
        <nav aria-label="Footer">
          <a href={GITHUB}>
            <Github size={14} /> GitHub
          </a>
          <a href="/testnet">Testnet web demo</a>
          <a href="/privacy">Privacy</a>
          <a href="/data-deletion">Data deletion</a>
        </nav>
      </footer>
    </div>
  );
}
