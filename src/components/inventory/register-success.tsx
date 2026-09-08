import type { AssetClass } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { withClsQS } from "@/lib/asset-class";

/**
 * The panel a batch registration swaps in for the form on success (Task 13,
 * spec §2.3). `children` is the slot for a `docError` banner — the batch's
 * invoice can fail to attach after the assets themselves are safely created,
 * and that failure must not read as the registration itself having failed.
 */
export function RegisterSuccess({
  tags,
  ids,
  cls,
  onAgain,
  children,
}: {
  tags: string[];
  ids: string[];
  cls: AssetClass;
  onAgain: () => void;
  children?: React.ReactNode;
}) {
  const range = tags.length === 1 ? tags[0] : `${tags[0]} … ${tags[tags.length - 1]}`;
  return (
    <Card>
      <CardHeader title={`${tags.length} asset${tags.length === 1 ? "" : "s"} registered — ${range}`} />
      <CardBody className="flex flex-col gap-3">
        {children}
        <div className="flex flex-wrap gap-2">
          <ButtonLink variant="primary" href={`/inventory/labels?ids=${ids.join(",")}`}>Print labels</ButtonLink>
          <ButtonLink href={"/inventory" + withClsQS("", cls)}>Open the list</ButtonLink>
          <Button onClick={onAgain}>Register another batch</Button>
        </div>
      </CardBody>
    </Card>
  );
}
