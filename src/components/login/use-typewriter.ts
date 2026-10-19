// Types a line out one character at a time (spec §4.5, §6): the room bubble at 34 ms per character, the forward
// Cris's at 30. Reduced motion shows the whole line at once. A new line (or the same line again after a null)
// starts over from nothing.
import { useEffect, useState } from "react";

export function useTypewriter(
  text: string | null,
  opts: { reduced: boolean; msPerChar: number; startDelayMs?: number },
): { shown: string; done: boolean } {
  const { reduced, msPerChar, startDelayMs = 0 } = opts;
  const [count, setCount] = useState(0);
  // Reset during render when the line changes, so a new line never flashes the old one's progress.
  const [typing, setTyping] = useState(text);
  if (typing !== text) {
    setTyping(text);
    setCount(0);
  }

  useEffect(() => {
    if (text === null || reduced) return;
    let n = 0;
    let tick: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      tick = setInterval(() => {
        n += 1;
        setCount(n);
        if (n >= text.length) clearInterval(tick);
      }, msPerChar);
    }, startDelayMs);
    return () => {
      clearTimeout(start);
      clearInterval(tick);
    };
  }, [text, reduced, msPerChar, startDelayMs]);

  if (text === null) return { shown: "", done: false };
  if (reduced) return { shown: text, done: true };
  return { shown: text.slice(0, count), done: count >= text.length };
}
