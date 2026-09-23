import Link from "next/link";
import type { AssetClass } from "@prisma/client";
import { Banner } from "@/components/ui/banner";
import { ButtonLink } from "@/components/ui/button-link";

/**
 * Shown on the record page right after registration (`?created=1`) — a server
 * component, since it carries no state of its own and the record page already
 * knows the tag, id and class from the asset it just loaded. Phase 30 (spec
 * §5.6): the two next steps are printing its label and registering another of
 * the same class.
 */
export function CreatedNotice({ tag, id, cls, canRegister }: {
  tag: string;
  id: string;
  cls: AssetClass;
  /** A shared `?created=1` link must not hand a viewer or Finance a create control. */
  canRegister: boolean;
}) {
  return (
    <Banner
      tone="settled"
      title={`${tag} registered`}
      actions={
        <span className="flex items-center gap-3">
          <ButtonLink href={`/inventory/labels?ids=${id}`} size="sm">Print label</ButtonLink>
          {canRegister && (
            <Link href={`/inventory/register?cls=${cls}`} className="text-xs text-accent underline hover:text-accent-hover">
              Register another
            </Link>
          )}
        </span>
      }
    />
  );
}
