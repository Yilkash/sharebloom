import {
  ArrowUpRight,
  BadgeCheck,
  Bot,
  Github,
  Lock,
  MessageCircle,
  Scale,
  ShieldCheck,
  Timer,
  Wallet,
} from "lucide-react";
import { publicStats } from "@/server/public-stats";
import { MAINNET_STOCK_SYMBOLS } from "@/server/networks/chain";
import styles from "./landing.module.css";

export const dynamic = "force-dynamic";

const WHATSAPP = "https://wa.me/2349032729156?text=Hi";
const GITHUB = "https://github.com/Yilkash/sharebloom";

const examples = [
  "Buy Apple with 5 USDT",
  "What would 10 USDT get me in Tesla?",
  "Buy the S&P 500 with 20 USDT",
  "Sell 0.01 NVIDIA",
  "Show my stocks",
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
    title: "AI understands you",
    body: "SERV Reasoning turns your message into the right action, with a prompt-injection guard on every message.",
  },
  {
    icon: Scale,
    title: "Three issuers compared",
    body: "bStocks, Ondo and xStocks are quoted side by side against Binance's reference price. Unfair quotes are rejected.",
  },
  {
    icon: BadgeCheck,
    title: "You tap Confirm",
    body: "The fairest trade settles on BNB Chain and you get a BscScan receipt in the chat.",
  },
];

const safety = [
  {
    icon: Lock,
    title: "The AI never holds keys",
    body: "No tool can confirm or submit a transaction. Only your button press can.",
  },
  {
    icon: Scale,
    title: "No bad fills",
    body: "Any quote more than 2% worse than Binance's price for that token is refused, and halted tokens are skipped.",
  },
  {
    icon: Wallet,
    title: "Your own wallet",
    body: "Each user gets a Privy wallet whose policy only allows the 27 listed stock tokens, USDT and KyberSwap.",
  },
  {
    icon: Timer,
    title: "Exact, expiring reviews",
    body: "Every review shows the issuer, minimum received and maximum fee, expires in 4 minutes, and confirms once.",
  },
];

// Live comparison captured on 2026-09-29 for a 1 USDT Apple buy on BNB Chain.
const comparison = [
  { token: "AAPLB", issuer: "bStocks", result: "Best fair price", tone: "best" },
  { token: "AAPLon", issuer: "Ondo", result: "Fair, slightly less stock", tone: "ok" },
  { token: "AAPLx", issuer: "xStocks", result: "Rejected: 509% above fair price", tone: "bad" },
] as const;

export default function Landing() {
  const stats = publicStats();
  return (
    <div className={styles.page}>
      <header className={styles.nav}>
        <a className={styles.brand} href="/">
          <img className={styles.brandMark} src="/images/sharebloom-logo.png" alt="" />
          <span>
            sharebloom<span className={styles.dot}>.</span>
          </span>
        </a>
        <nav className={styles.links} aria-label="Sections">
          <a href="#how">How it works</a>
          <a href="#fair-price">Fair price</a>
          <a href="#safety">Safety</a>
          <a href={GITHUB}>GitHub</a>
        </nav>
        <a className={styles.navCta} href={WHATSAPP}>
          <MessageCircle size={16} /> Chat now
        </a>
      </header>

      <main className={styles.main}>
        <section className={styles.hero}>
          <div className={styles.heroText}>
            <p className={styles.eyebrow}>Tokenized US stocks · BNB Chain</p>
            <h1>
              Own a piece of Apple by <span className={styles.highlight}>texting</span>.
            </h1>
            <p className={styles.lead}>
              Buy Apple, Tesla, NVIDIA, the S&amp;P 500 and more with USDT, right inside WhatsApp.
              Sharebloom compares bStocks, Ondo and xStocks and trades the fairest price.
            </p>
            <div className={styles.ctas}>
              <a className={styles.primary} href={WHATSAPP}>
                <MessageCircle size={18} /> Start on WhatsApp
              </a>
              <a className={styles.secondary} href="#fair-price">
                How we pick your price <ArrowUpRight size={16} />
              </a>
            </div>
          </div>
          <div className={styles.phoneMock} aria-label="Example Sharebloom conversation">
            <div className={styles.phoneHeader}>
              <img className={styles.brandMark} src="/images/sharebloom-logo.png" alt="" />
              Sharebloom
            </div>
            <div className={styles.chat}>
              <p className={styles.me}>Buy Apple with 5 USDT</p>
              <p className={styles.bot}>
                <b>Buy Apple (AAPL)</b>
                <br />
                BNB Chain · Issuer: bStocks (AAPLB)
                <br />
                best fair price of 3
                <br />
                <br />
                Pay: 5 USDT
                <br />
                Receive: ≈ 0.01482 AAPLB
                <br />
                <b>[ Confirm buy ]</b>
              </p>
              <p className={styles.me}>Confirm buy</p>
              <p className={styles.bot}>Trade complete ✅ BscScan receipt ↗</p>
            </div>
          </div>
        </section>

        <section className={styles.stats} aria-label="Sharebloom at a glance">
          {stats && (
            <div>
              <b>{stats.users}</b>
              <span>users with their own wallet</span>
            </div>
          )}
          <div>
            <b>{MAINNET_STOCK_SYMBOLS.length}</b>
            <span>stocks and ETFs, from Apple to the S&amp;P 500</span>
          </div>
          <div>
            <b>3</b>
            <span>issuers compared on every trade</span>
          </div>
          <div>
            <b>24/7</b>
            <span>trading on BNB Chain</span>
          </div>
        </section>

        <section className={styles.section}>
          <p className={styles.eyebrow}>Just say it</p>
          <h2>Things you can text Sharebloom</h2>
          <div className={styles.examples}>
            {examples.map((text) => (
              <code key={text}>{text}</code>
            ))}
          </div>
        </section>

        <section id="how" className={styles.section}>
          <p className={styles.eyebrow}>How it works</p>
          <h2>AI understands. Code compares. You confirm.</h2>
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

        <section id="fair-price" className={styles.section}>
          <p className={styles.eyebrow}>Why it matters</p>
          <h2>The same stock can cost 6× more in the wrong pool.</h2>
          <p className={styles.sectionLead}>
            Each stock on BNB Chain is issued three times, with separate liquidity. Some pools are
            thin. A live 1 USDT Apple buy on 29 September 2026:
          </p>
          <ul className={styles.comparison}>
            {comparison.map((row) => (
              <li key={row.token} className={styles[row.tone]}>
                <code>{row.token}</code>
                <span>{row.issuer}</span>
                <b>{row.result}</b>
              </li>
            ))}
          </ul>
          <p className={styles.note}>
            Reference prices and trading status come from Binance&apos;s RWA data for each exact
            token. Routes come from KyberSwap.
          </p>
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

        <section className={styles.final}>
          <h2>Your first stock is one message away.</h2>
          <p>Say hi, create your account, add a little USDT and BNB, and start owning.</p>
          <a className={styles.primary} href={WHATSAPP}>
            <MessageCircle size={18} /> Chat with Sharebloom
          </a>
        </section>
      </main>

      <footer className={styles.footer}>
        <span>
          Sharebloom by Steward Pay · Powered by SERV Reasoning · Stock tokens are BNB Chain tokens,
          not direct share ownership.
        </span>
        <nav aria-label="Footer">
          <a href={GITHUB}>
            <Github size={14} /> GitHub
          </a>
          <a href="/privacy">Privacy</a>
          <a href="/data-deletion">Data deletion</a>
        </nav>
      </footer>
    </div>
  );
}
