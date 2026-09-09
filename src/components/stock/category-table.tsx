"use client";

import { useState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Table, THead, TBody, Th, Tr, Td } from "@/components/ui/table";
import { Pill } from "@/components/ui/pill";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { formatStockCode } from "@/lib/stock-code";
import {
  archiveStockCategory, createStockCategory, restoreStockCategory, updateStockCategory,
} from "@/server/modules/stock/item-actions";
import { useStockRunner } from "./use-stock-runner";

export interface CategoryRow {
  id: string;
  name: string;
  prefix: string;
  nextNumber: number;
  items: number;
  archived: boolean;
}

/** One shared runner (task-4 brief): the create row and at most one open row-edit share it, so `reset()` on entering edit clears anything the create row left behind. */
export function CategoryTable({ rows }: { rows: CategoryRow[] }) {
  const [newName, setNewName] = useState("");
  const [newPrefix, setNewPrefix] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrefix, setEditPrefix] = useState("");
  const { pending, error, fieldErrors, retryAfter, setRetryAfter, reset, run } = useStockRunner(["name", "prefix"]);

  function startEdit(row: CategoryRow) {
    reset();
    setEditingId(row.id);
    setEditName(row.name);
    setEditPrefix(row.prefix);
  }

  function createCategory() {
    run(
      () => createStockCategory({ name: newName, prefix: newPrefix }),
      "Category created",
      { onOk: () => { setNewName(""); setNewPrefix(""); } },
    );
  }

  function saveEdit(id: string) {
    run(
      () => updateStockCategory({ id, name: editName, prefix: editPrefix }),
      "Saved",
      { onOk: () => setEditingId(null) },
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}
      <Table>
        <THead>
          <Tr>
            <Th>Name</Th>
            <Th>Prefix</Th>
            <Th>Next code</Th>
            <Th align="right">Items</Th>
            <Th aria-label="Row actions" />
          </Tr>
        </THead>
        <TBody>
          <Tr>
            <Td>
              <Input
                aria-label="New category name"
                placeholder="Name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              {editingId === null && <FormError>{fieldErrors.name}</FormError>}
            </Td>
            <Td>
              <Input
                aria-label="New category prefix"
                placeholder="e.g. OS"
                value={newPrefix}
                onChange={(e) => setNewPrefix(e.target.value.toUpperCase())}
                className="w-20 font-mono uppercase"
              />
              {editingId === null && <FormError>{fieldErrors.prefix}</FormError>}
            </Td>
            <Td colSpan={2} className="text-fg-muted">—</Td>
            <Td align="right">
              <Button size="sm" variant="primary" loading={pending} onClick={createCategory}>
                Create category
              </Button>
            </Td>
          </Tr>
          {rows.map((row) => {
            const editing = editingId === row.id;
            return (
              <Tr key={row.id}>
                <Td>
                  {editing ? (
                    <>
                      <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                      <FormError>{fieldErrors.name}</FormError>
                    </>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      {row.name}
                      {row.archived && <Pill>ARCHIVED</Pill>}
                    </span>
                  )}
                </Td>
                <Td mono>
                  {editing && row.items === 0 ? (
                    <>
                      <Input
                        value={editPrefix}
                        onChange={(e) => setEditPrefix(e.target.value.toUpperCase())}
                        className="w-20 font-mono uppercase"
                      />
                      <FormError>{fieldErrors.prefix}</FormError>
                    </>
                  ) : (
                    row.prefix
                  )}
                </Td>
                <Td mono>{formatStockCode(row.prefix, row.nextNumber)}</Td>
                <Td align="right" mono>{row.items}</Td>
                <Td align="right">
                  <div className="inline-flex gap-2">
                    {editing ? (
                      <>
                        <Button size="sm" variant="primary" loading={pending} onClick={() => saveEdit(row.id)}>
                          Save
                        </Button>
                        <Button size="sm" onClick={() => setEditingId(null)}>Cancel</Button>
                      </>
                    ) : (
                      <>
                        <Button size="sm" onClick={() => startEdit(row)}>Rename</Button>
                        {row.archived ? (
                          <Button
                            size="sm"
                            loading={pending}
                            onClick={() => run(() => restoreStockCategory({ id: row.id }), "Category restored")}
                          >
                            Restore category
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            loading={pending}
                            onClick={() => run(() => archiveStockCategory({ id: row.id }), "Category archived")}
                          >
                            Archive category
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </Td>
              </Tr>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}
