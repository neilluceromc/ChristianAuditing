import Link from "next/link";

/**
 * Phase 14 (spec §3.3): person-centric pages list every asset a person holds,
 * but a tag the viewer cannot open is text, not a link that lands on not-found.
 */
export function TagRef({ id, tag, visible, className }: { id: string; tag: string; visible: boolean; className?: string }) {
  if (!visible) {
    return <span className="font-mono text-fg-secondary" title="Outside your register">{tag}</span>;
  }
  return <Link href={`/inventory/${id}`} className={className ?? "font-mono text-accent hover:underline"}>{tag}</Link>;
}
