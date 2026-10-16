import Link from "next/link";
import { Banner } from "@/components/ui/banner";
import { createdNoticeExtras } from "@/lib/new-employee";

/**
 * Phase 25 (spec §5.1): the profile right after creation (`?created=1`) — the employee twin of the asset record's CreatedNotice.
 * Phase 37 (spec §5.4): Add employee's `assigned` and `failed` ride along — "{n} items assigned", and one line per spare
 * that could not be assigned. Both are read defensively: a hand-edited URL shows nothing extra, never an error.
 */
export function EmployeeCreatedNotice({
  name, employeeNo, id, assigned = null, failed = null,
}: {
  name: string;
  employeeNo: string;
  id: string;
  assigned?: string | null;
  failed?: string | null;
}) {
  const extras = createdNoticeExtras(assigned, failed);
  return (
    <Banner tone={extras.failed.length ? "attention" : "settled"} title={`${name} added · ${employeeNo}`}>
      {extras.assigned > 0 && <p>{extras.assigned === 1 ? "1 item assigned" : `${extras.assigned} items assigned`}</p>}
      {extras.failed.map((f, i) => (
        <p key={`${f.tag}-${i}`}>{f.tag} could not be assigned: {f.reason}</p>
      ))}
      <p>
        <a className="text-accent underline" href="#loadout">Assign devices</a>
        {" · "}
        <Link href={`/employees/${id}/form`} className="text-accent underline">Accountability form</Link>
      </p>
    </Banner>
  );
}
