import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LABELS_PER_PAGE } from "@/lib/label-geometry";
import type { AssetClass } from "@prisma/client";

/**
 * Spec §5.1 (plan P-10): a plain GET form to /inventory/labels — no server
 * action and no client JavaScript, so it renders from the Server Component
 * page as-is. The page reads `?tags=` and `?start=` and builds the sheet.
 *
 * `mode="tags"` is the Tags box (a textarea plus Start at label); on the
 * `?ids=` sheet view `mode="start"` re-submits the same ids with a new start,
 * so Start at label works on both paths. `cls` rides along only for the
 * class-aware crumb (IT is the default and is never written).
 */
export function TagsBox({
  mode,
  tags = "",
  ids,
  start = 1,
  cls,
}: {
  mode: "tags" | "start";
  tags?: string;
  ids?: string;
  start?: number;
  cls: AssetClass;
}) {
  return (
    <form method="get" action="/inventory/labels" className="flex max-w-[520px] flex-col gap-3">
      {cls === "PURCHASING" && <input type="hidden" name="cls" value="PURCHASING" />}
      {mode === "start" && ids && <input type="hidden" name="ids" value={ids} />}
      {mode === "tags" && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="labels-tags" className="text-xs font-medium text-fg">Tags</label>
          <Textarea
            id="labels-tags"
            name="tags"
            rows={5}
            defaultValue={tags}
            aria-describedby="labels-tags-hint"
            className="font-mono"
            spellCheck={false}
            autoCapitalize="characters"
          />
          <p id="labels-tags-hint" className="text-[11px] text-fg-muted">
            One per line, or separated by commas — paste or scan
          </p>
        </div>
      )}
      <div className="flex items-end gap-2">
        <div className="flex w-[140px] flex-col gap-1.5">
          <label htmlFor="labels-start" className="text-xs font-medium text-fg">Start at label</label>
          <Input
            id="labels-start"
            name="start"
            type="number"
            min={1}
            max={LABELS_PER_PAGE}
            step={1}
            defaultValue={start}
            inputMode="numeric"
          />
        </div>
        <Button type="submit" variant={mode === "tags" ? "primary" : "secondary"}>Make sheet</Button>
      </div>
    </form>
  );
}
