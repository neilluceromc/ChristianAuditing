import { cn } from "@/lib/cn";

/** 1.7px ring, top border in accent, 700ms linear spin. */
export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn("inline-block rounded-full", className)}
      style={{
        width: size,
        height: size,
        border: "1.7px solid var(--border-strong)",
        borderTopColor: "var(--accent)",
        animation: "spin 700ms linear infinite",
      }}
    />
  );
}
