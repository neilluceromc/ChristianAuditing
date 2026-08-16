import type { Metadata } from "next";
import { cookies } from "next/headers";
import { ToastProvider } from "@/components/ui/toast";
import "./globals.css";

export const metadata: Metadata = {
  title: "Backroom IT — Inventory",
  description: "IT asset management for The Backroom Offshoring",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // br.theme / br.density are written by the Phase 1 toggles; reading them
  // here is what makes the choice survive a reload (the cookie contract).
  const jar = await cookies();
  const theme = jar.get("br.theme")?.value === "dark" ? "dark" : "light";
  const density = jar.get("br.density")?.value === "compact" ? "compact" : "comfortable";
  return (
    <html lang="en" data-theme={theme} data-density={density} suppressHydrationWarning>
      <body className="bg-canvas text-fg font-sans antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
