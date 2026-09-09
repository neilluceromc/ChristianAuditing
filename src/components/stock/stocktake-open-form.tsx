"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { RateLimitNotice } from "@/components/patterns/rate-limit-notice";
import { openStocktake } from "@/server/modules/stock/stocktake-actions";
import { useStockRunner } from "./use-stock-runner";

export interface StocktakeCategoryOption {
  id: string;
  name: string;
}

const CLAIMED = ["categoryId", "note"];

/** Spec §5.3, Task 5 Step 3. `categoryId` "all" is the literal scope meaning every category (stocktakeOpenSchema). */
export function StocktakeOpenForm({ categories }: { categories: StocktakeCategoryOption[] }) {
  const router = useRouter();
  const [categoryId, setCategoryId] = useState("all");
  const [note, setNote] = useState("");
  const { pending, error, fieldErrors, retryAfter, setRetryAfter, run } = useStockRunner(CLAIMED);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    run(() => openStocktake({ categoryId, note }), "Stocktake opened", {
      refresh: false,
      onOk: (data) => router.push(`/stock/stocktakes/${data.id}`),
    });
  }

  return (
    <form onSubmit={submit} className="flex max-w-[520px] flex-col gap-4">
      {retryAfter !== null && <RateLimitNotice retryAfterSec={retryAfter} onExpire={() => setRetryAfter(null)} />}
      {error && <Banner tone="fault" title={error} />}
      <Card>
        <CardHeader title="Stocktake" />
        <CardBody className="flex flex-col gap-4">
          <FormField label="Scope" error={fieldErrors.categoryId}>
            {(p) => (
              <Select
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={categoryId} onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="all">All categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label="Note" error={fieldErrors.note}>
            {(p) => (
              <Textarea
                id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
                value={note} onChange={(e) => setNote(e.target.value)}
              />
            )}
          </FormField>
        </CardBody>
      </Card>
      <div>
        <Button type="submit" variant="primary" loading={pending}>Open stocktake</Button>
      </div>
    </form>
  );
}
