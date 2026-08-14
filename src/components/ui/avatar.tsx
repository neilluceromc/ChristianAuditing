import { cn } from "@/lib/cn";

const SIZES = { xs: 19, sm: 20, md: 24, lg: 26, xl: 34, xxl: 62 } as const;

export function Avatar({
  name,
  size = "md",
  className,
}: {
  name: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const px = SIZES[size];
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex items-center justify-center rounded-full bg-accent-soft font-mono font-semibold text-accent-soft-text",
        className,
      )}
      style={{ width: px, height: px, fontSize: Math.max(8.5, px * 0.36) }}
    >
      {initials}
    </span>
  );
}
