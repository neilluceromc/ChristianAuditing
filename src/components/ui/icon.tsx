import { cn } from "@/lib/cn";

export type IconName =
  | "laptop" | "monitor" | "phone" | "dock" | "headset" | "inventory"
  | "employee" | "approval" | "audit" | "search" | "filter" | "sla"
  | "alert" | "secret" | "export" | "add"
  | "workstation" | "mouse" | "hub" | "bag" | "other" | "scan"
  | "keyboard" | "webcam" | "ups" | "license" | "menu"
  | "home" | "worklist" | "offboarding" | "reservations" | "reports" | "activity" | "setup"
  | "requests" | "suppliers" | "stock" | "depreciation" | "users" | "webhooks" | "flags" | "chevron" | "sidebar"
  | "disposal";

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
  // Phase 34: the Register category cards (`categoryIcon` in register-catalog.ts) and the Labels scan hint.
  workstation: (<><rect x="1.5" y="3" width="10" height="7" /><line x1="6.5" y1="10" x2="6.5" y2="13.5" /><line x1="4" y1="13.5" x2="9" y2="13.5" /><rect x="13" y="3" width="3.5" height="11" /></>),
  mouse: (<><rect x="5" y="2.5" width="8" height="13" rx="4" /><line x1="9" y1="4.5" x2="9" y2="7.5" /></>),
  keyboard: (<><rect x="1.5" y="5" width="15" height="8.5" rx="1" /><line x1="4" y1="8" x2="5" y2="8" /><line x1="7" y1="8" x2="8" y2="8" /><line x1="10" y1="8" x2="11" y2="8" /><line x1="13" y1="8" x2="14" y2="8" /><line x1="5" y1="11" x2="13" y2="11" /></>),
  webcam: (<><circle cx="9" cy="7.5" r="5" /><circle cx="9" cy="7.5" r="1.8" /><path d="M6 12 L5 15.5 h8 L12 12" /></>),
  ups: (<><rect x="4.5" y="1.5" width="9" height="15" rx="1" /><polyline points="9.8,4.5 7.5,9 10.5,9 8.2,13.5" /></>),
  license: (<><rect x="2" y="2.5" width="14" height="13" rx="1" /><line x1="9" y1="2.5" x2="9" y2="15.5" /><line x1="2" y1="9" x2="16" y2="9" /></>),
  hub: (<><rect x="7" y="1.5" width="4" height="4" /><rect x="3.5" y="5.5" width="11" height="10" /><line x1="6" y1="12" x2="12" y2="12" /></>),
  bag: (<><rect x="2" y="6" width="14" height="9.5" /><path d="M6.5 6 V3.5 h5 V6" /><line x1="2" y1="10" x2="16" y2="10" /></>),
  other: (<><rect x="2.5" y="2.5" width="5" height="5" /><rect x="10.5" y="2.5" width="5" height="5" /><rect x="2.5" y="10.5" width="5" height="5" /><line x1="13" y1="10.5" x2="13" y2="15.5" /><line x1="10.5" y1="13" x2="15.5" y2="13" /></>),
  scan: (<><polyline points="2,6 2,2 6,2" /><polyline points="12,2 16,2 16,6" /><polyline points="16,12 16,16 12,16" /><polyline points="6,16 2,16 2,12" /><line x1="4.5" y1="9" x2="13.5" y2="9" /></>),
  // Phase 40 (spec §3): the phone top bar's menu button — three equal lines, not the filter funnel.
  menu: (<><line x1="3" y1="5" x2="15" y2="5" /><line x1="3" y1="9" x2="15" y2="9" /><line x1="3" y1="13" x2="15" y2="13" /></>),
  // Phase 42 (spec §4.5): the sidebar's link icons, and the chevron (pointing right) on links with views.
  home: (<><polyline points="2.5,8.5 9,3 15.5,8.5" /><polyline points="4.5,7 4.5,15 13.5,15 13.5,7" /><polyline points="7.5,15 7.5,10.5 10.5,10.5 10.5,15" /></>),
  worklist: (<><polyline points="2.5,4.5 3.8,5.8 6,3.5" /><line x1="8.5" y1="4.5" x2="15.5" y2="4.5" /><polyline points="2.5,9 3.8,10.3 6,8" /><line x1="8.5" y1="9" x2="15.5" y2="9" /><line x1="3" y1="13.5" x2="5.5" y2="13.5" /><line x1="8.5" y1="13.5" x2="15.5" y2="13.5" /></>),
  offboarding: (<><polyline points="10,3 3,3 3,15 10,15" /><line x1="7" y1="9" x2="16" y2="9" /><polyline points="13,6 16,9 13,12" /></>),
  reservations: (<><rect x="2.5" y="3.5" width="13" height="12" /><line x1="2.5" y1="7" x2="15.5" y2="7" /><line x1="6" y1="2" x2="6" y2="5" /><line x1="12" y1="2" x2="12" y2="5" /><polyline points="6.5,11 8.3,12.8 11.5,9.5" /></>),
  reports: (<><polyline points="2.5,2.5 2.5,15.5 15.5,15.5" /><line x1="6" y1="12.5" x2="6" y2="9" /><line x1="9.5" y1="12.5" x2="9.5" y2="5.5" /><line x1="13" y1="12.5" x2="13" y2="7.5" /></>),
  activity: (<><polyline points="1.5,9 5,9 7,4 11,14 13,9 16.5,9" /></>),
  setup: (<><circle cx="9" cy="9" r="2.5" /><circle cx="9" cy="9" r="5.5" /><line x1="9" y1="1.5" x2="9" y2="3.5" /><line x1="9" y1="14.5" x2="9" y2="16.5" /><line x1="1.5" y1="9" x2="3.5" y2="9" /><line x1="14.5" y1="9" x2="16.5" y2="9" /><line x1="12.9" y1="5.1" x2="14.3" y2="3.7" /><line x1="5.1" y1="5.1" x2="3.7" y2="3.7" /><line x1="12.9" y1="12.9" x2="14.3" y2="14.3" /><line x1="5.1" y1="12.9" x2="3.7" y2="14.3" /></>),
  requests: (<><polyline points="11,2.5 4,2.5 4,15.5 14,15.5 14,5.5 11,2.5 11,5.5 14,5.5" /><line x1="6.5" y1="9" x2="11.5" y2="9" /><line x1="6.5" y1="12" x2="11.5" y2="12" /></>),
  suppliers: (<><rect x="1.5" y="4.5" width="9" height="8" /><polyline points="10.5,7 14,7 16.5,10 16.5,12.5 10.5,12.5" /><circle cx="5" cy="14" r="1.5" /><circle cx="13" cy="14" r="1.5" /></>),
  stock: (<><rect x="2.5" y="9.5" width="6" height="6" /><rect x="9.5" y="9.5" width="6" height="6" /><rect x="6" y="2.5" width="6" height="6" /></>),
  depreciation: (<><polyline points="2.5,2.5 2.5,15.5 15.5,15.5" /><polyline points="5,5 8.5,9 11,8 15,12.5" /><polyline points="12.5,12.5 15,12.5 15,10" /></>),
  users: (<><circle cx="7" cy="6" r="2.5" /><path d="M2 15 V13 a5 3.5 0 0 1 10 0 V15" /><path d="M11.5 3.8 a2.5 2.5 0 0 1 0 4.4" /><path d="M14 10.2 a4 3.5 0 0 1 2 2.8 V15" /></>),
  webhooks: (<><line x1="7.5" y1="10.5" x2="10.5" y2="7.5" /><path d="M8.5 5 L10 3.5 a2.5 2.5 0 0 1 3.5 0 l1 1 a2.5 2.5 0 0 1 0 3.5 L13 9.5" /><path d="M9.5 13 L8 14.5 a2.5 2.5 0 0 1 -3.5 0 l-1 -1 a2.5 2.5 0 0 1 0 -3.5 L5 8.5" /></>),
  flags: (<><line x1="4" y1="2" x2="4" y2="16" /><polyline points="4,3 14.5,3 12,6.5 14.5,10 4,10" /></>),
  chevron: (<><polyline points="7,4 12,9 7,14" /></>),
  sidebar: (<><rect x="2.5" y="3" width="13" height="12" /><line x1="7" y1="3" x2="7" y2="15" /></>),
  // Phase 47: Finance › Disposal — a bin.
  disposal: (<><line x1="2.5" y1="4.5" x2="15.5" y2="4.5" /><polyline points="7,4.5 7,2.5 11,2.5 11,4.5" /><polyline points="4,4.5 5,15.5 13,15.5 14,4.5" /><line x1="7.5" y1="7.5" x2="7.5" y2="12.5" /><line x1="10.5" y1="7.5" x2="10.5" y2="12.5" /></>),
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
