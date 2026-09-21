import Link from "next/link";
import { Banner } from "@/components/ui/banner";

/** Phase 25 (spec §5.1): the profile right after creation (`?created=1`) — the employee twin of the asset record's CreatedNotice. */
export function EmployeeCreatedNotice({ name, employeeNo, id }: { name: string; employeeNo: string; id: string }) {
  return (
    <Banner tone="settled" title={`${name} added · ${employeeNo}`}>
      <a className="text-accent underline" href="#loadout">Assign devices</a>
      {" · "}
      <Link href={`/employees/${id}/form`} className="text-accent underline">Accountability form</Link>
    </Banner>
  );
}
