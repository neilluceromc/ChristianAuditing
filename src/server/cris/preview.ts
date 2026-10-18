import { previewReply } from "@/lib/cris-preview";
import { personTextOf } from "@/lib/cris-prompt";
import type { CrisModel, CrisReply, CrisRequest } from "./model";

/*
 * Preview mode (added 2026-10-18, owner's request): the CrisModel used when there is no AI key (see pickModel). It
 * calls nothing and reads nothing: one text block from the owner's placeholder lines, never a tool call, so no
 * lookup and no change can follow. Model "preview" is not a priced model, so the month's cost stays 0. The turn
 * stores preview rows with no model messages, so they are never replayed to the real model once a key is added.
 * NOT "use server".
 */

export const PREVIEW_MODEL_ID = "preview";

export const previewModel: CrisModel = {
  id: PREVIEW_MODEL_ID,
  async reply({ messages, turn = 0 }: CrisRequest): Promise<CrisReply> {
    // The newest person message is answered. `turn` (their earlier messages in this conversation) turns the lines in
    // order, so two replies in a row are never the same line — counted by the turn, since earlier preview turns are
    // kept out of `messages`.
    const said = messages.map(personTextOf).filter((t): t is string => t !== null);
    const text = previewReply(said[said.length - 1] ?? "", turn);
    return {
      content: [{ type: "text", text, citations: null }],
      stop: "end_turn",
      model: PREVIEW_MODEL_ID,
      usage: { input: 0, output: 0 },
    };
  },
};
