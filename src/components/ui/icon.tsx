import { cn } from "@/lib/cn";

export type IconName =
  | "laptop" | "monitor" | "phone" | "dock" | "headset" | "inventory"
  | "employee" | "approval" | "audit" | "search" | "filter" | "sla"
  | "alert" | "secret" | "export" | "add";

const PATHS: Record<IconName, React.ReactNode> = {
  laptop: (<><rect x="3" y="4" width="12" height="8" /><line x1="1.5" y1="14.5" x2="16.5" y2="14.5" /></>),
  monitor: (<><rect x="2.5" y="3" width="13" height="9" /><line x1="9" y1="12" x2="9" y2="15" /><line x1="6" y1="15" x2="12" y2="15" /></>),
  phone: (<><rect x="5.5" y="2" width="7" height="14" rx="1" /><line x1="8" y1="13.5" x2="10" y2="13.5" /></>),
  dock: (<><rect x="2.5" y="10" width="13" height="4" /><line x1="9" y1="10" x2="9" y2="4" /><line x1="6" y1="4" x2="12" y2="4" /></>),
  headset: (<><path d="M4 10 V7 a5 5 0 0 1 10 0 v3" /><rect x="2.5" y="10" width="3" height="4" /><rect x="12.5" y="10" width="3" height="4" /></>),
  inventory: (<><rect x="3" y="5" width="12" height="10" /><polyline points="3,5 9,2.5 15,5" /><line x1="9" y1="8" x2="9" y2="12" /></>),
  employee: (<><circle cx="9" cy="6" r="3" /><path d="M3.5 15.5 V13 a5.5 4 0 0 1 11 0 v2.5" /></>),
  approval: (<><rect x="3" y="3" width="12" height="12" /><polyline points="6,9 8.2,11.2 12,7" /></>),
  audit: (<><line x1="4" y1="4.5" x2="14" y2="4.5" /><line x1="4" y1="9" x2="14" y2="9" /><line x1="4" y1="13.5" x2="10" y2="13.5" /></>),
  search: (<><circle cx="8" cy="8" r="4.5" /><line x1="11.5" y1="11.5" x2="15.5" y2="15.5" /></>),
  filter: (<><line x1="3" y1="5" x2="15" y2="5" /><line x1="5.5" y1="9" x2="12.5" y2="9" /><line x1="7.5" y1="13" x2="10.5" y2="13" /></>),
  sla: (<><circle cx="9" cy="9" r="6.5" /><polyline points="9,5.5 9,9 12,10.5" /></>),
  alert: (<><polyline points="9,2.5 16,15 2,15 9,2.5" /><line x1="9" y1="7.5" x2="9" y2="10.5" /><circle cx="9" cy="12.8" r="0.7" fill="currentColor" stroke="none" /></>),
  secret: (<><circle cx="6.5" cy="9" r="3.5" /><line x1="10" y1="9" x2="15.5" y2="9" /><line x1="13" y1="9" x2="13" y2="12" /><line x1="15.5" y1="9" x2="15.5" y2="11.5" /></>),
  export: (<><line x1="9" y1="11.5" x2="9" y2="2.5" /><polyline points="5.5,6 9,2.5 12.5,6" /><polyline points="3,11 3,15 15,15 15,11" /></>),
  add: (<><line x1="9" y1="3.5" x2="9" y2="14.5" /><line x1="3.5" y1="9" x2="14.5" y2="9" /></>),
};

export function Icon({
  name,
  size = 18,
  className,
  label,
}: {
  name: IconName;
  size?: number;
  className?: string;
  label?: string;
}) {
  return (
    <svg
      viewBox="0 0 18 18"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="square"
      strokeLinejoin="miter"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("shrink-0", className)}
    >
      {PATHS[name]}
    </svg>
  );
}
