/** Spec §5.1: pasted or scanned tags — one per line, tab or comma; trimmed, upper-cased, first occurrence kept. */
export function parseTagPaste(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.split(/[\r\n\t,]+/)) {
    const tag = raw.trim().toUpperCase();
    if (tag) seen.add(tag);
  }
  return [...seen];
}
