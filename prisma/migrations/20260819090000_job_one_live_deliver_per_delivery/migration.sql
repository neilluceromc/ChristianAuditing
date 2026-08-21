-- At most one live delivery job per WebhookDelivery row. The exact mirror of
-- Job_one_live_execute_per_approval (20260814090100_integrity_constraints):
-- Task 13's Replay re-enqueues, and a double-click would otherwise put two
-- workers on one delivery and POST the same envelope twice — which a receiver
-- cannot deduplicate, because a replay reuses the delivery's id and therefore
-- produces a byte-identical envelope and signature (see webhooks/sign.ts).
--
-- Raw SQL with no schema.prisma counterpart, like the three integrity
-- constraints before it: `prisma db pull` will not reproduce it. HANDOVER §8
-- tracks that gap rather than pretending it isn't there.
CREATE UNIQUE INDEX "Job_one_live_deliver_per_delivery"
  ON "Job" ((payload->>'deliveryId'))
  WHERE "status" IN ('PENDING', 'RUNNING') AND "type" = 'DELIVER_WEBHOOK';

-- The other half of that guarantee, and the half the plan for this task left
-- out: the partial unique above indexes an EXPRESSION, and a DELIVER_WEBHOOK
-- job with no 'deliveryId' key yields NULL, which never collides with
-- anything. Without this constraint the index silently permits unlimited live
-- jobs for a malformed payload — the identical reasoning, and the identical
-- pairing, as Job_execute_payload_shape in
-- 20260814093000_provenance_restrict_and_indexes. Copying the index without
-- its companion copies half a guarantee.
ALTER TABLE "Job" ADD CONSTRAINT "Job_deliver_payload_shape"
  CHECK (type <> 'DELIVER_WEBHOOK' OR payload ? 'deliveryId');
