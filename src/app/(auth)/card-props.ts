// What the sign-in card needs from the server, shared by /login and /signup so both Welcome steps offer the same
// ways in. The rules are the login page's as before Phase 44 (flags, Microsoft, quick sign-in, `next`).
import { prisma } from "@/server/db/client";
import { signIn } from "@/server/auth";
import { flagDomain } from "@/lib/auth-shared";
import { parseQuickLoginEmails } from "@/lib/quick-login";
import { ROLE_LABELS } from "@/lib/admin-users";
import type { LoginExperienceProps } from "@/components/login/login-experience";

async function microsoftSignIn() {
  "use server";
  await signIn("microsoft-entra-id");
}

export async function loadCardProps({
  next,
  quick,
}: {
  next?: string;
  quick?: string;
}): Promise<LoginExperienceProps["card"]> {
  const [ssoFlag, domainFlag] = await Promise.all([
    prisma.featureFlag.findUnique({ where: { key: "m365_sso" } }),
    prisma.featureFlag.findUnique({ where: { key: "allowed_domain" } }),
  ]);
  const showMicrosoft = !!ssoFlag?.enabled && !!process.env.AUTH_MICROSOFT_ENTRA_ID_ID;
  // Staging-only one-click sign-in: off (no query, no section) unless
  // QUICK_LOGIN_EMAILS lists accounts. Only existing, enabled accounts show, in the env list's order.
  const quickEmails = parseQuickLoginEmails(process.env.QUICK_LOGIN_EMAILS);
  const quickAccounts =
    quickEmails.length === 0
      ? []
      : (
          await prisma.user.findMany({
            where: { email: { in: quickEmails }, disabled: false },
            select: { email: true, role: true },
          })
        ).sort((a, b) => quickEmails.indexOf(a.email) - quickEmails.indexOf(b.email));

  return {
    domain: flagDomain(domainFlag),
    next,
    microsoftAction: showMicrosoft ? microsoftSignIn : null,
    quick:
      quickEmails.length === 0
        ? null
        : {
            accounts: quickAccounts.map((a) => ({ email: a.email, label: ROLE_LABELS[a.role] })),
            refused: quick === "refused",
          },
    viewerLanding: "/", // Home, like every sign-in (follow-up spec §7.1)
  };
}
