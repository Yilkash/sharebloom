import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Sharebloom — Buy tokenized US stocks on WhatsApp",
  description:
    "Buy Apple, Tesla, NVIDIA and more with USDT on BNB Chain, just by chatting on WhatsApp. Sharebloom compares bStocks, Ondo and xStocks and trades the fairest price.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
