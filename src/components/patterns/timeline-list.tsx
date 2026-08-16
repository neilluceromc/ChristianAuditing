import { StatusDot } from "@/components/ui/status";

export interface TimelineItem {
  id: string;
  /** preformatted display date */
  at: string;
  /** any status value for the dot; omit for a neutral dot */
  status?: string;
  title: React.ReactNode;
  meta?: string;
}

export function TimelineList({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="ml-2 flex flex-col border-l border-border-faint pl-5">
      {items.map((item) => (
        <li key={item.id} className="relative pb-5">
          <span className="absolute -left-[24.5px] top-[5px] rounded-full bg-canvas p-[1px]">
            <StatusDot value={item.status ?? "SPARE"} />
          </span>
          <div className="text-[12.5px] text-fg-secondary">{item.title}</div>
          <div className="pt-0.5 font-mono text-[10.5px] text-fg-faint">
            {item.meta ? `${item.meta} · ` : ""}{item.at}
          </div>
        </li>
      ))}
    </ol>
  );
}
