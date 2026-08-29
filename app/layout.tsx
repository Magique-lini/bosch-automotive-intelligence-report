import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "汽车行业情报日报",
  description: "每日汽车行业动态、关键 Partner 新闻变化与最近 20 天归档。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "汽车行业情报日报",
    description: "每日行业动态 · Partner 新闻 · 20 天归档",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "汽车行业情报日报",
    description: "每日行业动态 · Partner 新闻 · 20 天归档",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
