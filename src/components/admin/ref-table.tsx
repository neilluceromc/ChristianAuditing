"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { AssetClass } from "@prisma/client";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Menu } from "@/components/ui/menu";
import { Pill } from "@/components/ui/pill";
import { Select } from "@/components/ui/select";
import { Table, TBody, Td, Th, THead, Tr } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { ASSET_CLASSES, CLASS_LABEL } from "@/lib/asset-class";
import { createRefRow, deleteRefRow, renameRefRow } from "@/server/modules/admin/reference-actions";

export interface RefRow {
  id: string;
  name: string;
  usage: string; // "12 assets · 2 types" — preformatted server-side
  locked: boolean;
  categoryName?: string; // types only
  cls?: AssetClass; // categories only
}

/** One table design serves all three reference screens (README 4c): inline add row, locked rows, in-use delete refusal. */
export function RefTable({
  entity,
  rows,
  categories,
  fixedCls,
}: {
  entity: "category" | "type" | "department";
  rows: RefRow[];
  categories?: Array<{ id: string; name: string }>;
  fixedCls?: AssetClass;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [newName, setNewName] = useState("");
  const [newCategory, setNewCategory] = useState(categories?.[0]?.id ?? "");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  const [newCls, setNewCls] = useState<AssetClass>(fixedCls ?? ASSET_CLASSES[0]);
  const isType = entity === "type";
  const isCategory = entity === "category";

  function run(fn: () => Promise<{ ok: boolean } & Record<string, unknown>>, okMsg: string) {
    setError(null);
    setFieldError(null);
    startTransition(async () => {
      const res = (await fn()) as Awaited<ReturnType<typeof createRefRow>>;
      if (res.ok) {
        toast(okMsg, "settled");
        setNewName("");
        setRenaming(null);
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else if (res.kind === "validation") setFieldError(Object.values(res.fieldErrors ?? {})[0] ?? res.message);
      else setError(res.message);
    });
  }

  return (
    <div className="flex max-w-[720px] flex-col gap-3">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}

      <Table>
        <THead>
          <Tr>
            <Th>Name</Th>
            {isCategory && <Th width={130}>Class</Th>}
            {isType && <Th width={140}>Category</Th>}
            <Th width={200}>In use by</Th>
            <Th width={60} aria-label="Row actions" />
          </Tr>
        </THead>
        <TBody>
          {/* Inline add row — reference data is entered in batches, not through dialogs. */}
          <Tr className="bg-surface-subtle">
            <Td>
              <div className="flex flex-col gap-1 py-1.5">
                <Input
                  aria-label={`New ${entity} name`}
                  placeholder={`Add a ${entity}…`}
                  value={newName}
                  invalid={!!fieldError}
                  className="py-1.5 text-xs"
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      run(() => createRefRow({ entity, name: newName, categoryId: isType ? newCategory : undefined, cls: isCategory ? newCls : undefined }), "Added");
                    }
                  }}
                />
                {fieldError && <p role="alert" className="text-[11px] font-medium" style={{ color: "var(--error-text)" }}>{fieldError}</p>}
              </div>
            </Td>
            {isCategory && (
              <Td>
                {fixedCls ? (
                  <span className="font-mono text-[10.5px] text-fg-muted" aria-label="Class for the new category">{CLASS_LABEL[fixedCls].toUpperCase()}</span>
                ) : (
                  <Select aria-label="Class for the new category" value={newCls} className="py-1.5 text-xs"
                    onChange={(e) => setNewCls(e.target.value as AssetClass)}>
                    {ASSET_CLASSES.map((c) => <option key={c} value={c}>{CLASS_LABEL[c]}</option>)}
                  </Select>
                )}
              </Td>
            )}
            {isType && (
              <Td>
                <Select aria-label="Category for the new type" value={newCategory} className="py-1.5 text-xs"
                  onChange={(e) => setNewCategory(e.target.value)}>
                  {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Td>
            )}
            <Td className="text-fg-faint">—</Td>
            <Td>
              <Button size="sm" variant="primary" loading={pending}
                onClick={() => run(() => createRefRow({ entity, name: newName, categoryId: isType ? newCategory : undefined, cls: isCategory ? newCls : undefined }), "Added")}>
                Add
              </Button>
            </Td>
          </Tr>
          {rows.map((row) => (
            <Tr key={row.id}>
              <Td>
                {renaming?.id === row.id ? (
                  <Input
                    aria-label={`Rename ${row.name}`}
                    value={renaming.name}
                    autoFocus
                    className="py-1.5 text-xs"
                    onChange={(e) => setRenaming({ id: row.id, name: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") run(() => renameRefRow({ entity, id: row.id, name: renaming.name }), "Renamed");
                      if (e.key === "Escape") setRenaming(null);
                    }}
                    onBlur={() => setRenaming(null)}
                  />
                ) : (
                  <span className="text-[12.5px] text-fg">{row.name}</span>
                )}
              </Td>
              {isCategory && <Td mono className="text-[10.5px]">{row.cls && CLASS_LABEL[row.cls].toUpperCase()}</Td>}
              {isType && <Td>{row.categoryName}</Td>}
              <Td mono className="text-[10.5px]">{row.usage}</Td>
              <Td>
                {row.locked ? (
                  <Pill>LOCKED</Pill>
                ) : (
                  <Menu
                    trigger={(props) => (
                      <button type="button" {...props} aria-label={`Actions for ${row.name}`}
                        className="rounded-(--radius-ctl) px-2 py-0.5 text-fg-muted hover:bg-surface-subtle">
                        ⋯
                      </button>
                    )}
                    items={[
                      { label: "Rename", onSelect: () => setRenaming({ id: row.id, name: row.name }) },
                      { label: "Delete", danger: true, onSelect: () => run(() => deleteRefRow({ entity, id: row.id }), "Deleted") },
                    ]}
                  />
                )}
              </Td>
            </Tr>
          ))}
        </TBody>
      </Table>
      {isCategory && (
        <p className="text-xs text-fg-faint">A category&apos;s class is fixed once it has assets.</p>
      )}
    </div>
  );
}
