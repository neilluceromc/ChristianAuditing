"use client";

import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { fieldClasses } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { Select } from "@/components/ui/select";
import { useOverlayLayer } from "@/components/ui/use-focus-trap";
import { matchModels, resolveModelType, type KnownModel } from "@/lib/known-models";

/**
 * Phase 34 (spec §4.2): Model is one field that also sets the type. It lists
 * the models already registered in the category; picking one takes its type.
 * A free-text value is allowed — a model not in the list is a new model, and
 * only then is the type asked, in one native select. Like the house
 * `EntityCombobox` (ESC through the overlay stack, a click outside closes),
 * but the typed text is the value.
 */
export function ModelCombobox({
  id,
  models,
  types,
  value,
  onValue,
  typeId,
  onType,
  placeholder,
  invalid,
  describedBy,
  typeError,
  inputRef,
}: {
  id: string;
  models: KnownModel[];
  types: Array<{ id: string; name: string }>;
  value: string;
  onValue: (v: string) => void;
  typeId: string;
  onType: (id: string) => void;
  placeholder: string;
  invalid?: boolean;
  describedBy?: string;
  /** The refusal for the new-model type select. */
  typeError?: string;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  // -1 = nothing active: Enter then keeps the typed text instead of taking the first match.
  const [active, setActive] = useState(-1);
  const [changing, setChanging] = useState(false);

  useOverlayLayer(open, () => setOpen(false));

  // A category with one type takes it silently (spec §4.2). Keyed on the type
  // ids, so it runs when the category changes, not on every render.
  const typeKey = types.map((t) => t.id).join(",");
  const onTypeRef = useRef(onType);
  onTypeRef.current = onType;
  useEffect(() => {
    if (types.length === 1) onTypeRef.current(types[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- typeKey stands for `types`
  }, [typeKey]);

  const resolved = resolveModelType(models, value);
  const matches = matchModels(models, value);
  const offerNew = value.trim() !== "" && !resolved.known;
  // The rows the list shows: the matches, then "+ Add" for a new model.
  const count = matches.length + (offerNew ? 1 : 0);
  const typeName = (tid: string | null) => types.find((t) => t.id === tid)?.name;

  function change(v: string) {
    onValue(v);
    setOpen(true);
    setActive(-1);
    // Review Focus 1: a model typed in another case or spacing is still the
    // known one, and takes its type without being picked from the list.
    const r = resolveModelType(models, v);
    if (r.known) {
      onType(r.typeId ?? "");
      setChanging(false);
    } else if (resolved.known && types.length > 1) {
      // Edited away from a known model: a new model asks its own type rather than keep the old one's.
      onType("");
    }
  }

  function pick(i: number) {
    if (i < matches.length) {
      const m = matches[i];
      onValue(m.model);
      onType(m.typeId ?? "");
      setChanging(false);
    }
    // "+ Add … as a new model" keeps the text and only closes the list.
    setOpen(false);
    setActive(-1);
  }

  const optionId = (i: number) => `${listId}-o${i}`;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          role="combobox"
          aria-expanded={open && count > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 && active < count ? optionId(active) : undefined}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          autoComplete="off"
          className={fieldClasses(invalid)}
          placeholder={placeholder}
          value={value}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={() => {
            setTimeout(() => setOpen(false), 120); // let an option's mousedown land first
            const trimmed = value.trim().replace(/\s+/g, " ");
            if (trimmed !== value) onValue(trimmed);
          }}
          onChange={(e) => change(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((i) => Math.min(i + 1, count - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              // Never submits (the form blocks Enter in fields too); picks the active row if there is one.
              e.preventDefault();
              if (open && active >= 0 && active < count) pick(active);
              else setOpen(false);
            }
          }}
        />
        {open && count > 0 && (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-40 mt-1 max-h-[260px] w-full overflow-y-auto rounded-(--radius-btn) border border-border bg-surface-raised p-1 shadow-pop"
            style={{ animation: "fade var(--dur-2) var(--ease-std)" }}
          >
            {matches.map((m, i) => (
              <li
                key={m.model}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                aria-label={m.model}
                aria-describedby={`${optionId(i)}-d`}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-[5px] px-2 py-1.5 text-xs",
                  i === active ? "bg-accent-tint text-fg" : "text-fg-secondary",
                )}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(i);
                }}
              >
                <span className="min-w-0 flex-1 truncate font-medium">{m.model}</span>
                <span id={`${optionId(i)}-d`} className="flex shrink-0 items-center gap-2">
                  {typeName(m.typeId) && (
                    <span className="rounded-(--radius-micro) border border-border bg-surface-subtle px-1.5 text-[10.5px] text-fg-secondary">
                      {typeName(m.typeId)}
                    </span>
                  )}
                  <span className="text-[11px] text-fg-muted">{m.inStock > 0 ? `${m.inStock} in stock` : "none in stock"}</span>
                </span>
              </li>
            ))}
            {offerNew && (
              <li
                id={optionId(matches.length)}
                role="option"
                aria-selected={active === matches.length}
                className={cn(
                  "cursor-pointer rounded-[5px] px-2 py-1.5 text-xs font-medium",
                  active === matches.length ? "bg-accent-tint text-fg" : "text-accent",
                )}
                onMouseEnter={() => setActive(matches.length)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(matches.length);
                }}
              >
                + Add &ldquo;{value.trim()}&rdquo; as a new model
              </li>
            )}
          </ul>
        )}
      </div>

      {resolved.known && (
        <p className="text-[12px] text-fg-secondary">
          Type: <b className="font-semibold text-fg">{typeName(resolved.typeId) ?? "none"}</b> — set by this model
          {types.length > 1 && !changing && (
            <>
              {" "}
              <button type="button" className="text-accent underline underline-offset-2" onClick={() => setChanging(true)}>
                Change type
              </button>
            </>
          )}
        </p>
      )}

      {types.length > 1 && value.trim() !== "" && (!resolved.known || changing) && (
        <FormField
          label={resolved.known ? "Type" : "New model — which type?"}
          required
          hint={resolved.known ? undefined : "Next time this model fills it in for you."}
          error={typeError}
        >
          {(p) => (
            <Select
              id={p.id} aria-describedby={p["aria-describedby"]} invalid={p.invalid}
              required
              value={typeId}
              onChange={(e) => onType(e.target.value)}
            >
              <option value="">Pick a type…</option>
              {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          )}
        </FormField>
      )}
    </div>
  );
}
