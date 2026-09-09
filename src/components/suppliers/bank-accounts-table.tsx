"use client";

import { Button } from "@/components/ui/button";
import { Table, THead, TBody, Th, Tr, Td } from "@/components/ui/table";

export interface BankAccountRow {
  id: string;
  label: string;
  bankName: string;
  accountName: string;
  accountLast4: string;
}

/** The row half of bank-accounts-card.tsx, split out to keep that file under the 150-line guideline. */
export function BankAccountsTable({
  accounts,
  revealed,
  revealPending,
  canReveal,
  canManage,
  onReveal,
  onRemove,
}: {
  accounts: BankAccountRow[];
  revealed: Record<string, string>;
  revealPending: boolean;
  canReveal: boolean;
  canManage: boolean;
  onReveal: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  if (accounts.length === 0) {
    return <p className="py-2 text-center text-xs text-fg-muted">No bank accounts on file.</p>;
  }
  const showActions = canReveal || canManage;
  return (
    <Table>
      <THead>
        <Tr>
          <Th>Label</Th>
          <Th>Bank</Th>
          <Th>Account name</Th>
          <Th>Number</Th>
          {showActions && <Th aria-label="Actions" />}
        </Tr>
      </THead>
      <TBody>
        {accounts.map((a) => (
          <Tr key={a.id}>
            <Td>{a.label}</Td>
            <Td>{a.bankName}</Td>
            <Td>{a.accountName}</Td>
            <Td mono>{revealed[a.id] ?? `•••• ${a.accountLast4}`}</Td>
            {showActions && (
              <Td align="right">
                <span className="inline-flex gap-2">
                  {canReveal && !revealed[a.id] && (
                    <Button size="sm" loading={revealPending} onClick={() => onReveal(a.id)}>Reveal</Button>
                  )}
                  {canManage && (
                    <Button size="sm" variant="ghost" onClick={() => onRemove(a.id)}>Remove</Button>
                  )}
                </span>
              </Td>
            )}
          </Tr>
        ))}
      </TBody>
    </Table>
  );
}
