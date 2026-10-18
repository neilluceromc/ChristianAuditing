import type { Metadata } from "next";
import { pageTitle } from "@/lib/page-title";
import { crisModeFrom } from "@/lib/cris-settings";
import { requireRole } from "@/server/auth/guards";
import { crisMonthUsage, crisPrefsFor, crisSettings } from "@/server/cris/settings-read";
import { PageHeader } from "@/components/ui/page-header";
import { CrisSettingsForm } from "@/components/cris/settings-form";

export const metadata: Metadata = { title: pageTitle("Cris") };

/** Spec §9, Settings › Cris (mockup board 3): "Your Cris" for everyone who has Cris, "Cris for everyone" for admins. */
export default async function CrisSettingsPage() {
  const user = await requireRole("admin", "it_staff");
  const isAdmin = user.role === "admin";
  const [prefs, settings, usage] = await Promise.all([
    crisPrefsFor(user.id),
    crisSettings(),
    isAdmin ? crisMonthUsage() : Promise.resolve(null),
  ]);
  // Only a yes/no ever leaves the server — never the key, nor any part of it. The same rule as
  // crisAvailability() and pickModel(), so the line agrees with how Cris answers (the fake model stands
  // in for the key outside production, as it does there; with neither, Cris is in preview).
  const keySet = crisModeFrom(process.env) !== "preview";

  return (
    <>
      <PageHeader title="Cris" breadcrumb={[{ label: "Settings" }, { label: "Cris" }]} />
      <CrisSettingsForm
        prefs={prefs}
        admin={isAdmin ? { settings, keySet, usage: usage ?? { questions: 0, costUsd: 0 } } : null}
        off={settings.on ? null : "off"}
      />
    </>
  );
}
