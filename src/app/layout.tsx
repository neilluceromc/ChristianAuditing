import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { ToastProvider } from "@/components/ui/toast";
import { parseDensity } from "@/lib/density";
import { APP_NAME } from "@/lib/page-title";
import "./globals.css";

// Self-hosted: next/font downloads Geist at build time and serves the files
// from the app, so every device renders the same face and the LAN staging
// box never calls Google at runtime. The CSS variables feed --font-sans /
// --font-mono in globals.css.
const geistSans = Geist({ subsets: ["latin"], display: "swap", variable: "--font-geist-sans" });
const geistMono = Geist_Mono({ subsets: ["latin"], display: "swap", variable: "--font-geist-mono" });

export const metadata: Metadata = {
  // Spec §5: the fallback when a page sets no title; every page sets "{Page} · CRIS" (Phase 47 spec §5.3).
  title: APP_NAME,
  description: "IT asset management for The Backroom Offshoring",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // br.theme / br.density are written by the Phase 1 toggles; reading them
  // here is what makes the choice survive a reload (the cookie contract).
  // Phase 47 spec §5.4: they now follow the person — the toggles also save
  // them to UserPreference `ui:prefs`, and UiPrefsSync (the app layout)
  // rewrites them when someone else signs in on this browser.
  const jar = await cookies();
  const theme = jar.get("br.theme")?.value === "dark" ? "dark" : "light";
  const density = parseDensity(jar.get("br.density")?.value);
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      data-theme={theme}
      data-density={density}
      suppressHydrationWarning
    >
      <body className="bg-canvas text-fg font-sans antialiased">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
