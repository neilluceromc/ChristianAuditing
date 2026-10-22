"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Table, THead, TBody, Th, Tr, Td } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { removePoDocument, replacePoDocument, uploadPoDocument } from "@/server/modules/purchases/document-actions";
import { PO_DOCUMENT_SLOTS, REQUEST_DOCUMENT_KINDS, REQUEST_DOCUMENT_LABEL, type PoDocumentSlot } from "@/lib/documents";
import { ACCEPT, DocSlot, SLOT_COPY } from "@/components/purchases/po-form/documents-card";

export interface RequestDocumentRow {
  id: string;
  kind: string;
  fileName: string;
  uploadedBy: string;
  at: string;
  downloadHref: string;
}

type RequestDocKind = (typeof REQUEST_DOCUMENT_KINDS)[number];

/** "Other documents" takes the kinds the four slots don't: the older quotation and purchase-order kinds, and other. */
const OTHER_KINDS = REQUEST_DOCUMENT_KINDS.filter((k) => !(PO_DOCUMENT_SLOTS as readonly string[]).includes(k));
const isSlot = (kind: string): kind is PoDocumentSlot => (PO_DOCUMENT_SLOTS as readonly string[]).includes(kind);

/**
 * A purchase order's documents (spec §2.8, §5b.1). The four slots of the PO form, stored straight away: a file picked
 * or dropped in a slot, or Replace, adds a new document of that kind (replacePoDocument) and the slot shows the
 * newest; Remove marks it superseded (removePoDocument). Nothing is deleted. Below, "Other documents" keeps today's
 * upload table for the quotation, purchase-order and other kinds, and lists a slot's earlier copies, so every file
 * still on the PO stays reachable. Purchasing, IT, Finance and admin can all add documents (`canUpload`); a viewer and
 * a cancelled PO only read.
 */
export function RequestDocumentsCard({
  requestId,
  docs,
  canUpload,
  invoiceRequired = false,
  si,
}: {
  requestId: string;
  /** The PO's documents still on it, newest first (getPurchase leaves the removed ones out). */
  docs: RequestDocumentRow[];
  canUpload: boolean;
  /** A PO from the new form (formV2): its sales invoice is required. */
  invoiceRequired?: boolean;
  /** The SI number, for the empty sales invoice slot's hint. */
  si?: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<RequestDocKind>(OTHER_KINDS[0]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);
  /**
   * The slots being stored or removed (a set: two slots can be in flight at once, and one finishing mustn't clear the
   * other's spinner), and each slot's last refusal.
   */
  const [busy, setBusy] = useState<ReadonlySet<PoDocumentSlot>>(() => new Set());
  const [slotErrors, setSlotErrors] = useState<Partial<Record<PoDocumentSlot, string>>>({});
  const [removing, setRemoving] = useState<{ slot: PoDocumentSlot; doc: RequestDocumentRow } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // docs are newest first: each slot shows the first of its kind; the rest go to "Other documents" as earlier copies
  const inSlot: Partial<Record<PoDocumentSlot, RequestDocumentRow>> = {};
  const others: Array<RequestDocumentRow & { label: string }> = [];
  for (const d of docs) {
    if (isSlot(d.kind) && !inSlot[d.kind]) inSlot[d.kind] = d;
    else {
      const label = REQUEST_DOCUMENT_LABEL[d.kind as RequestDocKind] ?? d.kind;
      others.push({ ...d, label: isSlot(d.kind) ? `${label} · earlier` : label });
    }
  }
  const attached = PO_DOCUMENT_SLOTS.filter((s) => inSlot[s]).length;

  function setSlotError(slot: PoDocumentSlot, message: string | null) {
    setSlotErrors((all) => {
      const next = { ...all };
      if (message) next[slot] = message;
      else delete next[slot];
      return next;
    });
  }

  function markBusy(slot: PoDocumentSlot, on: boolean) {
    setBusy((all) => {
      const next = new Set(all);
      if (on) next.add(slot);
      else next.delete(slot);
      return next;
    });
  }

  function storeInSlot(slot: PoDocumentSlot, file: File) {
    setSlotError(slot, null);
    setRetryAfter(null);
    markBusy(slot, true);
    const fd = new FormData();
    fd.set("orderId", requestId);
    fd.set("kind", slot);
    fd.set("file", file);
    startTransition(async () => {
      const res = await replacePoDocument(fd);
      markBusy(slot, false);
      if (res.ok) {
        toast(`${SLOT_COPY[slot].title} saved`, "settled");
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else setSlotError(slot, res.fieldErrors?.file ?? res.fieldErrors?.kind ?? res.message);
    });
  }

  function remove() {
    if (!removing) return;
    const { slot, doc } = removing;
    setRemoving(null);
    setSlotError(slot, null);
    setRetryAfter(null);
    markBusy(slot, true);
    startTransition(async () => {
      const res = await removePoDocument({ documentId: doc.id });
      markBusy(slot, false);
      if (res.ok) {
        toast(`${SLOT_COPY[slot].title} removed`, "settled");
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else setSlotError(slot, res.message);
    });
  }

  function upload(file: File) {
    setError(null);
    setRetryAfter(null);
    setFileName(file.name);
    const fd = new FormData();
    fd.set("requestId", requestId);
    fd.set("kind", kind);
    fd.set("file", file);
    startTransition(async () => {
      const res = await uploadPoDocument(fd);
      setFileName(null);
      if (res.ok) {
        toast("Document uploaded", "settled");
        router.refresh();
      } else if (res.kind === "rate_limited") setRetryAfter(res.retryAfterSec ?? 60);
      else setError(res.fieldErrors?.file ?? res.fieldErrors?.kind ?? res.message);
    });
  }

  return (
    <Card>
      <CardHeader title="Documents" actions={<span className="text-[13px] text-fg-secondary">{attached} of 4 attached</span>} />
      <CardBody className="flex flex-col gap-4">
        {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}

        <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3.5">
          {PO_DOCUMENT_SLOTS.map((slot) => {
            const doc = inSlot[slot];
            return (
              <DocSlot
                key={slot} kind={slot} required={invoiceRequired && slot === "invoice"} si={si ?? ""}
                shown={doc ? { fileName: doc.fileName, detail: `${doc.uploadedBy} · ${doc.at}`, preview: `${doc.downloadHref}?inline=1` } : null}
                onPick={canUpload ? (file) => storeInSlot(slot, file) : undefined}
                onRemove={canUpload && doc ? () => setRemoving({ slot, doc }) : undefined}
                error={slotErrors[slot]} busy={busy.has(slot)}
              />
            );
          })}
        </div>

        <div className="flex flex-col gap-3 border-t border-border-faint pt-3">
          <h3 className="text-[13px] font-semibold text-fg">Other documents</h3>
          {error && <Banner tone="fault" title="Upload rejected">{error}</Banner>}

          {others.length === 0 ? (
            <p className="py-2 text-center text-xs text-fg-muted">No other documents.</p>
          ) : (
            <Table>
              <THead>
                <Tr>
                  <Th>Kind</Th>
                  <Th>File</Th>
                  <Th>Uploaded by</Th>
                  <Th>Date</Th>
                  <Th aria-label="Download" />
                </Tr>
              </THead>
              <TBody>
                {others.map((d) => (
                  <Tr key={d.id}>
                    <Td>{d.label}</Td>
                    <Td><span className="block max-w-[16rem] truncate" title={d.fileName}>{d.fileName}</span></Td>
                    <Td>{d.uploadedBy}</Td>
                    <Td mono>{d.at}</Td>
                    <Td align="right"><a href={d.downloadHref} className="text-accent hover:underline">Download</a></Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          )}

          {canUpload && (
            <div className="flex flex-wrap items-center gap-2">
              <Select
                aria-label="Document kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as RequestDocKind)}
                className="w-auto py-1.5 text-xs"
              >
                {OTHER_KINDS.map((k) => <option key={k} value={k}>{REQUEST_DOCUMENT_LABEL[k]}</option>)}
              </Select>
              {pending && fileName ? (
                <span className="inline-flex items-center gap-2 text-xs text-fg-secondary">
                  <Spinner size={12} /> uploading {fileName}…
                </span>
              ) : (
                <Button size="sm" onClick={() => inputRef.current?.click()}>Upload</Button>
              )}
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                className="sr-only"
                aria-label="Document file"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) upload(file);
                  e.target.value = "";
                }}
              />
              <p className="font-mono text-[10px] text-fg-faint">PDF · PNG · JPG — max 4 MB · uploading again adds a new one</p>
            </div>
          )}
        </div>
      </CardBody>

      <Dialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        title={removing ? `Remove the ${SLOT_COPY[removing.slot].title.toLowerCase()}?` : ""}
        footer={(
          <>
            <Button onClick={() => setRemoving(null)}>Cancel</Button>
            <Button variant="danger" onClick={remove}>Remove</Button>
          </>
        )}
      >
        {removing && (
          <p className="text-[13px] text-fg-secondary">
            {removing.doc.fileName} leaves its slot. It stays on the purchase order&apos;s record — nothing is deleted.
          </p>
        )}
      </Dialog>
    </Card>
  );
}
