import { Banner } from "@/components/ui/banner";

/**
 * Task 12: shown on the record page right after registration (`?created=1`)
 * — a server component, since it carries no state of its own and the record
 * page already knows the tag and id from the asset it just loaded.
 */
export function CreatedNotice({ tag, id }: { tag: string; id: string }) {
  return (
    <Banner tone="settled" title={`${tag} registered`}>
      <a className="text-accent underline" href={`/inventory/labels?ids=${id}`}>Print label</a>
    </Banner>
  );
}
