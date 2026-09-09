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

/**
 * Two runner instances, not one: the create row and the row currently being
 * renamed each get their own `fieldErrors`/`pending`/banner surface, so a
 * failed create can never render under an unrelated row mid-rename (and vice
 * versa) — see task-4-review.md's Important finding. Starting either action
 * resets the other's runner, and opening a rename on a different row resets
 * both, matching `reset when the edited row changes`. Archive/restore share
 * the row runner since they are per-row actions like rename and never
 * populate `name`/`prefix` field errors.
 */
export function CategoryTable({ rows }: { rows: CategoryRow[] }) {
  const [newName, setNewName] = useState("");
  const [newPrefix, setNewPrefix] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrefix, setEditPrefix] = useState("");
  const {
    pending: creating, error: createError, fieldErrors: createFieldErrors,
    retryAfter: createRetryAfter, setRetryAfter: setCreateRetryAfter, reset: resetCreate, run: runCreate,
  } = useStockRunner(["name", "prefix"]);
  const {
    pending: rowPending, error: rowError, fieldErrors: rowFieldErrors,
    retryAfter: rowRetryAfter, setRetryAfter: setRowRetryAfter, reset: resetRow, run: runRow,
  } = useStockRunner(["name", "prefix"]);

  function startEdit(row: CategoryRow) {
    resetCreate();
    resetRow();
    setEditingId(row.id);
    setEditName(row.name);
    setEditPrefix(row.prefix);
  }

  function createCategory() {
    resetRow();
    runCreate(
      () => createStockCategory({ name: newName, prefix: newPrefix }),
      "Category created",
      { onOk: () => { setNewName(""); setNewPrefix(""); } },
    );
  }

  function saveEdit(id: string) {
    resetCreate();
    runRow(
      () => updateStockCategory({ id, name: editName, prefix: editPrefix }),
      "Saved",
      { onOk: () => setEditingId(null) },
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {createRetryAfter !== null && <RateLimitNotice retryAfterSec={createRetryAfter} onExpire={() => setCreateRetryAfter(null)} />}
      {rowRetryAfter !== null && <RateLimitNotice retryAfterSec={rowRetryAfter} onExpire={() => setRowRetryAfter(null)} />}
      {createError && <Banner tone="fault" title={createError} />}
      {rowError && <Banner tone="fault" title={rowError} />}
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
              <FormError>{createFieldErrors.name}</FormError>
            </Td>
            <Td>
              <Input
                aria-label="New category prefix"
                placeholder="e.g. OS"
                value={newPrefix}
                onChange={(e) => setNewPrefix(e.target.value.toUpperCase())}
                className="w-20 font-mono uppercase"
              />
              <FormError>{createFieldErrors.prefix}</FormError>
            </Td>
            <Td colSpan={2} className="text-fg-muted">—</Td>
            <Td align="right">
              <Button size="sm" variant="primary" loading={creating} onClick={createCategory}>
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
                      <FormError>{rowFieldErrors.name}</FormError>
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
                      <FormError>{rowFieldErrors.prefix}</FormError>
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
                        <Button size="sm" variant="primary" loading={rowPending} onClick={() => saveEdit(row.id)}>
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
                            loading={rowPending}
                            onClick={() => runRow(() => restoreStockCategory({ id: row.id }), "Category restored")}
                          >
                            Restore category
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            loading={rowPending}
                            onClick={() => runRow(() => archiveStockCategory({ id: row.id }), "Category archived")}
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
