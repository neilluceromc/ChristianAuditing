"use client";

import { useEffect, useState } from "react";
import { currentPlatform, searchShortcutLabel } from "@/lib/shortcuts";

/**
 * "Ctrl K", or "⌘K" on Mac (spec §2.3 / §4). The server cannot know the
 * platform, so the first render says "Ctrl K" and a Mac corrects it after
 * mount — no hydration mismatch.
 */
export function useSearchShortcutLabel(): "⌘K" | "Ctrl K" {
  const [label, setLabel] = useState<"⌘K" | "Ctrl K">("Ctrl K");
  useEffect(() => setLabel(searchShortcutLabel(currentPlatform())), []);
  return label;
}
