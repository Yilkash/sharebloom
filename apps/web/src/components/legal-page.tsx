import type { ReactNode } from "react";
import styles from "./legal-page.module.css";

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className={styles.page}>
      <nav aria-label="Privacy navigation" className={styles.nav}>
        <a href="/">Sharebloom</a>
        <a href="/privacy">Privacy policy</a>
        <a href="/data-deletion">Data deletion</a>
      </nav>
      <article>
        <h1>{title}</h1>
        <p className={styles.date}>Last updated: 24 September 2026</p>
        {children}
      </article>
      <p className={styles.contact}>
        Questions? <a href="mailto:stewardchat@gmail.com">stewardchat@gmail.com</a>
      </p>
    </main>
  );
}
