"use client";

import { useEffect, useRef, useState } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[contenteditable=""]',
  '[contenteditable="true"]',
  "details > summary",
  "audio[controls]",
  "video[controls]",
  "iframe",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getClientRects().length > 0 && !el.closest("[inert]"),
  );
}

/**
 * Module-level overlay layer stack shared by every overlay primitive.
 * - ESC is handled by the TOP layer only (one ESC = one layer).
 * - Body scroll locks while any MODAL layer is active, restoring the
 *   original value only when the last one leaves (no clobbering).
 * - Background body subtrees get `inert` while a modal is active, so
 *   focus can never escape the modal even through trap edge cases.
 */
type Layer = {
  container: HTMLElement | null;
  modal: boolean;
  onClose: () => void;
  inerted: HTMLElement[];
};

const layers: Layer[] = [];
let savedBodyOverflow: string | null = null;

function handleKeydown(e: KeyboardEvent) {
  const top = layers[layers.length - 1];
  if (!top) return;

  if (e.key === "Escape") {
    e.preventDefault();
    e.stopPropagation();
    top.onClose();
    return;
  }

  if (e.key !== "Tab") return;
  // Tab is constrained by the topmost MODAL layer (a non-modal menu above a
  // drawer still tabs within the drawer — the menu renders inside it).
  const modal = [...layers].reverse().find((l) => l.modal);
  if (!modal?.container) return;
  const container = modal.container;

  const nodes = focusableIn(container);
  if (nodes.length === 0) {
    e.preventDefault();
    container.focus();
    return;
  }
  const current = document.activeElement;
  const inTrap =
    current instanceof HTMLElement && container.contains(current) && current !== container;
  if (!inTrap) {
    e.preventDefault();
    (e.shiftKey ? nodes[nodes.length - 1] : nodes[0]).focus();
    return;
  }
  if (e.shiftKey && current === nodes[0]) {
    e.preventDefault();
    nodes[nodes.length - 1].focus();
  } else if (!e.shiftKey && current === nodes[nodes.length - 1]) {
    e.preventDefault();
    nodes[0].focus();
  }
}

function pushLayer(layer: Layer) {
  if (layers.length === 0) {
    document.addEventListener("keydown", handleKeydown, true);
  }
  if (layer.modal) {
    if (!layers.some((l) => l.modal)) {
      savedBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    if (layer.container) {
      for (const child of Array.from(document.body.children)) {
        if (
          child instanceof HTMLElement &&
          !child.contains(layer.container) &&
          !child.inert
        ) {
          child.inert = true;
          layer.inerted.push(child);
        }
      }
    }
  }
  layers.push(layer);
}

function popLayer(layer: Layer) {
  const i = layers.indexOf(layer);
  if (i !== -1) layers.splice(i, 1);
  for (const el of layer.inerted) el.inert = false;
  layer.inerted.length = 0;
  if (layer.modal && !layers.some((l) => l.modal) && savedBodyOverflow !== null) {
    document.body.style.overflow = savedBodyOverflow;
    savedBodyOverflow = null;
  }
  if (layers.length === 0) {
    document.removeEventListener("keydown", handleKeydown, true);
  }
}

/**
 * Full modal focus trap: Tab stays inside, ESC closes (top layer only),
 * focus returns to the previously focused element on close, body scroll
 * locks, background goes inert.
 *
 * Returns a CALLBACK REF — attach it to the overlay panel. Container
 * attachment is a state dependency, so the trap installs correctly even
 * when the overlay is conditionally mounted ({open && <Dialog …>}).
 */
export function useFocusTrap(
  active: boolean,
  onClose: () => void,
  opts?: { initialFocus?: "first" | "container" },
) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  const initialFocus = opts?.initialFocus ?? "first";

  useEffect(() => {
    if (!active || !container) return;

    const previous = document.activeElement as HTMLElement | null;
    const layer: Layer = {
      container,
      modal: true,
      onClose: () => onCloseRef.current(),
      inerted: [],
    };
    pushLayer(layer);

    if (initialFocus === "container") container.focus();
    else (focusableIn(container)[0] ?? container).focus();

    return () => {
      popLayer(layer);
      if (previous?.isConnected) previous.focus();
    };
  }, [active, container, initialFocus]);

  return setContainer as (node: HTMLElement | null) => void;
}

/**
 * Non-modal overlay layer (menus, popovers): participates in the ESC
 * stack — the top layer closes first — without trapping Tab or locking
 * scroll. onClose identity may change freely between renders.
 */
export function useOverlayLayer(active: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!active) return;
    const layer: Layer = {
      container: null,
      modal: false,
      onClose: () => onCloseRef.current(),
      inerted: [],
    };
    pushLayer(layer);
    return () => popLayer(layer);
  }, [active]);
}
