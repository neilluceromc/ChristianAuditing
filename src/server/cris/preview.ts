import { previewReply } from "@/lib/cris-preview";
import { personTextOf } from "@/lib/cris-prompt";
import type { CrisModel, CrisReply, CrisRequest } from "./model";

/*
 * Preview mode (added 2026-10-18, owner's request): the CrisModel used when there is no AI key (see pickModel). It
 * calls nothing and reads nothing: one text block from the owner's placeholder lines, never a tool call, so no
 * lookup and no change can follow. Model "preview" is not a priced model, so the month's cost stays 0. NOT "use server".
 */

export const PREVIEW_MODEL_ID = "preview";

export const previewModel: CrisModel = {
  id: PREVIEW_MODEL_ID,
  async reply({ messages }: CrisRequest): Promise<CrisReply> {
    // The person's words in this conversation, oldest first: the newest is answered, and the count turns the lines
    // in order, so two replies in a row are never the same line.
    const said = messages.map(personTextOf).filter((t): t is string => t !== null);
    const text = previewReply(said[said.length - 1] ?? "", Math.max(0, said.length - 1));
    return {
      content: [{ type: "text", text, citations: null }],
      stop: "end_turn",
      model: PREVIEW_MODEL_ID,
      usage: { input: 0, output: 0 },
    };
  },
};
