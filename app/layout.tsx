import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Conta — نظام المتجر",
  description: "نظام نقاط بيع ومشتريات ومخازن وحسابات قابل للتدقيق.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
