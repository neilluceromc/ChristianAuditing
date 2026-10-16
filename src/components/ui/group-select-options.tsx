import { groupPickerOptions, type PickerGroup } from "@/lib/groups";

/**
 * Phase 37 (spec §2.3, plan P-4): the options of a picker that chooses a department or a client —
 * two `<optgroup>`s, "Internal departments" then "Clients", active rows only, sorted by name. `keepId`
 * is the one archived row an edit form keeps showing (its current value). A group with nothing in it
 * is left out, so an empty "Clients" heading never shows. Render it inside a `<Select>`, after any
 * placeholder `<option>`.
 */
export function GroupSelectOptions({ groups, keepId }: { groups: PickerGroup[]; keepId?: string | null }) {
  const { internal, client } = groupPickerOptions(groups, keepId);
  return (
    <>
      {internal.length > 0 && (
        <optgroup label="Internal departments">
          {internal.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </optgroup>
      )}
      {client.length > 0 && (
        <optgroup label="Clients">
          {client.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </optgroup>
      )}
    </>
  );
}
