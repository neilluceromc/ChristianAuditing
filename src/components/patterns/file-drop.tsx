"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";

type Take =
  | { multiple?: false; onFile: (file: File) => void; onFiles?: never }
  | { multiple: true; onFiles: (files: File[]) => void; onFile?: never };

export type FileDropProps = Take & {
  /** The accessible name of the visually hidden file input. */
  label: string;
  accept?: string;
  hint?: string;
  disabled?: boolean;
};

/**
 * Phase 30 (spec §4.4, §5.3): the dashed drop zone with its `Choose file`
 * button. It only hands the chosen or dropped file(s) to the caller — nothing
 * is stored here, so every consumer can show the file and ask for what it
 * needs (a kind, an Upload) before anything is written.
 */
export function FileDrop(props: FileDropProps) {
  const { label, accept = ".pdf,.png,.jpg,.jpeg", hint = "PDF · PNG · JPG — max 10 MB", disabled = false } = props;
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function take(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    if (props.multiple) props.onFiles(files);
    else props.onFile(files[0]);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (!disabled) take(e.dataTransfer.files);
      }}
      className={cn(
        "flex flex-col items-center gap-2 rounded-(--radius-card) border border-dashed p-6 text-center",
        dragging ? "border-accent bg-accent-tint" : "border-border-strong",
      )}
    >
      <p className="text-xs text-fg-secondary">{props.multiple ? "Drop files here, or" : "Drop a file here, or"}</p>
      <Button type="button" size="sm" disabled={disabled} onClick={() => inputRef.current?.click()}>
        {props.multiple ? "Choose files" : "Choose file"}
      </Button>
      {hint && <p className="font-mono text-[10px] text-fg-faint">{hint}</p>}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={props.multiple}
        disabled={disabled}
        className="sr-only"
        // The Choose button opens it; a second, invisible tab stop would only lose the focus ring.
        tabIndex={-1}
        aria-label={label}
        onChange={(e) => {
          take(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
