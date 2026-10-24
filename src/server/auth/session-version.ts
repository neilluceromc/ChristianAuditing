import type { Prisma } from "@prisma/client";
import { sessionUpdateProof } from "./config.edge";

/**
 * Users & access (spec §4.2): signs the account out everywhere. Call it inside the transaction that makes the change
 * (a password reset or change, a role change, turning the account off, an email change), so the change and the
 * sign-out land together. The guards compare the token's copy with this counter on every request.
 * Returns the new value.
 */
export async function bumpSessionVersion(tx: Prisma.TransactionClient, userId: string): Promise<number> {
  const row = await tx.user.update({
    where: { id: userId },
    data: { sessionVersion: { increment: 1 } },
    select: { sessionVersion: true },
  });
  return row.sessionVersion;
}

export interface SessionUpdate {
  sessionVersion: number;
  mustChangePassword: boolean;
  proof: string;
}

/**
 * The data to pass to Auth.js's server-side `unstable_update` so THIS device's token takes the account's new values
 * (e.g. after the person changes their own password: they stay signed in here, everywhere else signs out). The jwt
 * callback ignores an update without a valid proof, so call this on the server only and never send it to a browser.
 */
export async function signedSessionUpdate(
  userId: string,
  sessionVersion: number,
  mustChangePassword: boolean,
): Promise<SessionUpdate> {
  return { sessionVersion, mustChangePassword, proof: await sessionUpdateProof(userId, sessionVersion, mustChangePassword) };
}
