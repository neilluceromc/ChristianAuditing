import Link from "next/link";

/** Spec §4.1 goal gradient: after a decision, the next request — or Queue clear. */
export function NextInQueue({ next }: { next: { id: string; refNo: string } | null }) {
  return next
    ? <Link href={`/approvals/${next.id}`} className="text-[12.5px] font-medium text-accent hover:underline">Next in queue → <span className="font-mono">{next.refNo}</span></Link>
    : <Link href="/approvals" className="text-[12.5px] font-medium text-accent hover:underline">Queue clear</Link>;
}
