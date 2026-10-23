/** A small download-arrow link for a row whose file name opens the Preview: named "Download <file>" for a screen reader. */
export function DownloadIconLink({ href, fileName }: { href: string; fileName: string }) {
  return (
    <a
      href={href}
      aria-label={`Download ${fileName}`}
      title="Download"
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-(--radius-btn) text-fg-secondary hover:bg-surface-subtle hover:text-fg"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 4v12M7 11l5 5 5-5M4 20h16" />
      </svg>
    </a>
  );
}
