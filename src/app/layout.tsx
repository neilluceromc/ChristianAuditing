import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Backroom IT — Inventory",
  description: "IT asset management for The Backroom Offshoring",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="light" data-density="comfortable" suppressHydrationWarning>
      <body className="bg-canvas text-fg font-sans antialiased">{children}</body>
    </html>
  );
}
