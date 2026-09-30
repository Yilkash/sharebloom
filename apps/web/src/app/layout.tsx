import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Sharebloom — Buy tokenized US stocks on WhatsApp",
  description:
    "Buy Apple, Tesla, NVIDIA and more with USDT on BNB Chain, just by chatting on WhatsApp. Sharebloom compares bStocks, Ondo and xStocks and trades the fairest price.",
};
const themeScript = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Apply a saved theme before the first paint so the page never flashes. */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
