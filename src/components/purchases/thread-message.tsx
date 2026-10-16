import { Avatar } from "@/components/ui/avatar";
import { Pill } from "@/components/ui/pill";
import { fmtDateTime } from "@/lib/format";
import { NOTE_CHIP, type ThreadNote } from "@/lib/purchase-thread";

/** One line of the conversation — who, the action chip, when, and what was said. The inline thread and the panel share it. */
export function ThreadMessage({ note: n, id }: { note: ThreadNote; id?: string }) {
  return (
    <li id={id} tabIndex={id ? -1 : undefined} className="flex gap-2.5 outline-none">
      <Avatar name={n.author} size="sm" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] font-medium text-fg">{n.author}</span>
          <Pill tone={n.kind === "COMMENT" ? "neutral" : "accent"}>{NOTE_CHIP[n.kind]}</Pill>
          <span className="font-mono text-[10px] text-fg-muted">{fmtDateTime(n.at)}</span>
        </div>
        <p className="break-words text-[12.5px] text-fg-secondary">{n.text}</p>
      </div>
    </li>
  );
}
