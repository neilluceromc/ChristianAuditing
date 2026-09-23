import Link from "next/link";
import type { AssetClass } from "@prisma/client";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { withViewClsQS } from "@/lib/asset-class";
import { TagRef } from "./tag-ref";

/** How many tags the card links before it counts the rest. */
const SHOWN = 10;

/**
 * The card a batch registration swaps in for the form (spec §5.6): every tag
 * it made, linked, with Print labels as the one primary. A failed invoice
 * upload does not undo the registration — it says so, and links the first
 * unit's Documents tab, where the invoice can be added.
 */
export function RegisterSuccess({
  tags,
  ids,
  cls,
  defaultCls,
  invoiceFailed,
  onAgain,
}: {
  tags: string[];
  ids: string[];
  cls: AssetClass;
  /** The viewer's default list class, so "Open the list" names the class only when it must. */
  defaultCls: AssetClass;
  invoiceFailed: boolean;
  onAgain: () => void;
}) {
  const range = tags.length === 1 ? tags[0] : `${tags[0]} … ${tags[tags.length - 1]}`;
  const rest = tags.length - SHOWN;
  return (
    <Card>
      <CardHeader title={`${tags.length} asset${tags.length === 1 ? "" : "s"} registered — ${range}`} />
      <CardBody className="flex flex-col gap-3">
        {invoiceFailed && (
          <Banner
            tone="attention"
            title="Registered — the invoice did not attach."
            actions={
              <Link href={`/inventory/${ids[0]}/documents`} className="text-xs text-accent underline hover:text-accent-hover">
                Add it on {tags[0]}&apos;s Documents tab
              </Link>
            }
          />
        )}
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {/* Registering needs the class in view (REGISTRABLE ⊆ VISIBLE for every role), so each tag opens. */}
          {tags.slice(0, SHOWN).map((tag, i) => <TagRef key={ids[i]} id={ids[i]} tag={tag} visible />)}
          {rest > 0 && <span className="text-fg-muted">and {rest} more</span>}
        </p>
        <div className="flex flex-wrap gap-2">
          <ButtonLink variant="primary" href={`/inventory/labels?ids=${ids.join(",")}`}>Print labels</ButtonLink>
          <ButtonLink href={"/inventory" + withViewClsQS("", cls, defaultCls)}>Open the list</ButtonLink>
          <Button onClick={onAgain}>Register another batch</Button>
        </div>
      </CardBody>
    </Card>
  );
}
