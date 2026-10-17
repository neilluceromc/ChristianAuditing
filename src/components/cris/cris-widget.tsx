"use client";

import {
  useCallback, useEffect, useId, useRef, useState, useSyncExternalStore,
  type KeyboardEvent, type PointerEvent,
} from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import type { CrisPrefs } from "@/lib/cris-prefs";
import { moodFor, resolveColor, type MoodState } from "@/lib/cris-mood";
import type { ConfirmCard, CrisViewMessage, PersonRef, ResultCard } from "@/lib/cris-cards";
import {
  CRIS_INSET, CRIS_MASCOT, CRIS_RESET_POSITION_EVENT, boxPlacement, bottomFromTop, clampBottom, dragPosition, nudgeBottom, snapSide, type CrisSide,
} from "@/lib/cris-placement";
import {
  TYPE_TICK_MS, liveMessageId, nextTyped, oldestSavedId, outcomeOfFailure, outcomeOfMood, personFirstFor, pressSettled, quickStarts, scannedSpare,
  waitingIn, type CrisPageContext, type QuickStart,
} from "@/lib/cris-box";
import { pageEntity } from "@/lib/cris-picks";
import type { ActionErrorKind } from "@/server/action-result";
import type { CrisSendInput } from "@/server/cris/turn-core";
import { crisHistory, crisNewChat, crisSend } from "@/server/cris/turn";
import { crisConfirm, crisUndo } from "@/server/cris/pending";
import { saveCrisPrefs } from "@/server/cris/settings";
import { crisPageContext } from "@/server/cris/context";
import { CrisOrb } from "./orb";
import { CrisBox } from "./cris-box";
import type { CardActions } from "./cris-cards";
import "./cris-widget.css";

/*
 * Spec §4 "Where Cris lives": one mascot per page, bottom-right, draggable while closed; pressing it opens the chat
 * box attached to it. One fixed dock holds the box, the hint and the mascot (pinned at the dock's top-left), so they
 * never drift apart. Ported from the CrisPage mockup; the geometry is src/lib/cris-placement.ts, the box's rules are
 * src/lib/cris-box.ts.
 */

export type CrisWidgetProps = {
  firstName: string;
  prefs: CrisPrefs;
  /** The theme the page was served in (the br.theme cookie); live changes follow <html data-theme>. */
  theme: "light" | "dark";
  /** The person's open conversation, if any; its messages load when the box first opens. */
  conversationId: string | null;
  left: number;
};

type Failure = { kind: ActionErrorKind; message: string; fieldErrors?: Record<string, string> };
type SendBody = Omit<CrisSendInput, "page" | "conversationId">;

// ── outside stores (theme, screen size, motion) ─────────────────────────────

function subscribeTheme(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
}
const readTheme = (): "light" | "dark" => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

function subscribeResize(cb: () => void) {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
}
/** The fixed dock's frame: the viewport less any scrollbar. */
const screenWidth = () => document.documentElement.clientWidth;
const screenHeight = () => document.documentElement.clientHeight;

function media(query: string) {
  return {
    subscribe(cb: () => void) {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    read: () => window.matchMedia(query).matches,
  };
}
/** The mockup's phone layout (cris-widget.css): a smaller Cris, fixed bottom-right, not draggable. */
const phoneMedia = media("(max-width: 640px)");
const reducedMedia = media("(prefers-reduced-motion: reduce)");
const no = () => false;

const SERVER_HEIGHT = 900;
const DROP_GLIDE_MS = 260;
const NUDGE_SAVE_MS = 600;
const BROKEN_TEXT = "Something went wrong — try again in a moment.";

let localSeq = 0;
/** A message only this page shows (the echo of what was sent, a refusal); the server never stored it. */
function localMessage(role: "user" | "cris", text: string): CrisViewMessage {
  localSeq += 1;
  return { id: `transient-local-${Date.now()}-${localSeq}`, role, text, cards: [], at: new Date().toISOString() };
}

export function CrisWidget({ firstName, prefs, theme: servedTheme, conversationId: startId, left: startLeft }: CrisWidgetProps) {
  const pathname = usePathname() ?? "/";
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => servedTheme);
  const phone = useSyncExternalStore(phoneMedia.subscribe, phoneMedia.read, no);
  const reduced = useSyncExternalStore(reducedMedia.subscribe, reducedMedia.read, no);
  const height = useSyncExternalStore(subscribeResize, screenHeight, () => SERVER_HEIGHT);
  const boxId = useId();

  const dockRef = useRef<HTMLElement | null>(null);
  const mascotRef = useRef<HTMLButtonElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  // ── where it sits ─────────────────────────────────────────────────────────
  const [pos, setPos] = useState<{ side: CrisSide; bottom: number }>({ side: prefs.side, bottom: prefs.bottom });
  // Settings' "Put Cris back in the corner" arrives as new props: follow it.
  const propPos = `${prefs.side}:${prefs.bottom}`;
  const [seenPropPos, setSeenPropPos] = useState(propPos);
  if (propPos !== seenPropPos) {
    setSeenPropPos(propPos);
    setPos({ side: prefs.side, bottom: prefs.bottom });
  }
  /** While dragging (live) or gliding to its side after the drop, the dock is placed by left/top. */
  const [dragAt, setDragAt] = useState<{ left: number; top: number; live: boolean } | null>(null);
  const drag = useRef<{ x: number; y: number; offsetX: number; offsetY: number; moved: boolean } | null>(null);
  const skipClick = useRef(false);
  const glideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Prefs saves are a partial merge on the server; one at a time, so a drag and the hint can't overwrite each other.
  const prefsQueue = useRef<Promise<unknown>>(Promise.resolve());
  const savePrefs = useCallback((patch: Partial<CrisPrefs>) => {
    prefsQueue.current = prefsQueue.current.then(() => saveCrisPrefs(patch)).catch(() => undefined);
  }, []);

  useEffect(() => () => {
    clearTimeout(glideTimer.current);
    clearTimeout(nudgeTimer.current);
  }, []);

  // Settings' "Put Cris back in the corner" (its own save already stored it): move now, and drop any arrow-key
  // save still waiting, which would otherwise put the old place back.
  useEffect(() => {
    const onReset = (e: Event) => {
      const d = (e as CustomEvent<{ side?: unknown; bottom?: unknown }>).detail;
      if (!d || (d.side !== "left" && d.side !== "right") || typeof d.bottom !== "number" || !Number.isFinite(d.bottom)) return;
      clearTimeout(nudgeTimer.current);
      clearTimeout(glideTimer.current);
      drag.current = null;
      setDragAt(null);
      setPos({ side: d.side, bottom: d.bottom });
    };
    window.addEventListener(CRIS_RESET_POSITION_EVENT, onReset);
    return () => window.removeEventListener(CRIS_RESET_POSITION_EVENT, onReset);
  }, []);

  // ── the box ───────────────────────────────────────────────────────────────
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const [big, setBig] = useState(false);
  const [seenHint, setSeenHint] = useState(prefs.seenHint);
  const [conversationId, setConversationId] = useState(startId);
  const [messages, setMessages] = useState<CrisViewMessage[]>([]);
  const [more, setMore] = useState(false);
  const [history, setHistory] = useState<"idle" | "loading" | "failed" | "ready">(startId ? "idle" : "ready");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const earlierRef = useRef(false);
  const [status, setStatus] = useState("Ready");
  const [outcome, setOutcome] = useState<MoodState["outcome"]>(null);
  const [left, setLeft] = useState(startLeft);
  const [unread, setUnread] = useState(0);
  const [confirmed, setConfirmed] = useState<ReadonlySet<string>>(() => new Set());
  const [undone, setUndone] = useState<ReadonlySet<string>>(() => new Set());
  const [queue, setQueue] = useState<string[]>([]);
  const [shown, setShown] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [draft, setDraft] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const [prependTick, setPrependTick] = useState(0);
  const [historyTick, setHistoryTick] = useState(0);
  const [earlierLoading, setEarlierLoading] = useState(false);
  const [scanFocusTick, setScanFocusTick] = useState(0);
  const [ctx, setCtx] = useState<{ path: string; value: CrisPageContext | null } | null>(null);

  // ── typing out (about 3 characters every 18 ms, the Talking mood) ──────────
  const typingId = queue[0] ?? null;
  const typingLen = (typingId ? messages.find((m) => m.id === typingId)?.text?.length : 0) ?? 0;
  useEffect(() => {
    if (!typingId) return;
    if (shown >= typingLen) {
      const t = setTimeout(() => {
        setQueue((q) => q.slice(1));
        setShown(0);
      }, 120);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setShown((s) => nextTyped(s, typingLen)), TYPE_TICK_MS);
    return () => clearTimeout(t);
  }, [typingId, shown, typingLen]);
  const typeOut = !reduced && prefs.motion !== "still";

  /** Cris's new messages: typed out when the box is open, counted on the badge when it is closed. */
  const arrive = (incoming: CrisViewMessage[]) => {
    const replies = incoming.filter((m) => m.role === "cris");
    setNow(Date.now());
    if (!openRef.current) setUnread((u) => u + replies.length);
    else if (typeOut) setQueue((q) => [...q, ...replies.filter((m) => m.text).map((m) => m.id)]);
  };

  // ── Undo's countdown ──────────────────────────────────────────────────────
  const undoShowing = messages.some((m) =>
    m.cards.some((c) => c.type === "result" && !undone.has(c.pendingId) && Date.parse(c.undoUntil) > now));
  useEffect(() => {
    if (!open || !undoShowing) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [open, undoShowing]);

  // ── focus: on open to the message box; never left on body when a focused control in the box goes away ─────
  const lastFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const note = (e: FocusEvent) => {
      const t = e.target as HTMLElement;
      lastFocus.current = dockRef.current?.contains(t) ? t : null;
    };
    document.addEventListener("focusin", note, true);
    return () => document.removeEventListener("focusin", note, true);
  }, [open]);
  useEffect(() => {
    if (open) composerRef.current?.focus();
  }, [open]);
  useEffect(() => {
    // A card stopped being live, Undo ran out, a button went busy: its focus would fall to body — the message box takes it.
    const el = lastFocus.current;
    if (!open || !el) return;
    const a = document.activeElement;
    const gone = !el.isConnected || el.matches(":disabled");
    if (gone && (!a || a === document.body)) composerRef.current?.focus();
  });

  // ── the page it was opened on (the context chip and the quick starts) ─────
  const fresh = messages.length === 0;
  const entity = pageEntity(pathname);
  const onEntity = !!(entity.employeeId || entity.assetId);
  const ctxPath = ctx?.path;
  useEffect(() => {
    if (!open || !fresh || !onEntity || ctxPath === pathname) return;
    let stale = false;
    crisPageContext({ path: pathname })
      .then((r) => !stale && setCtx({ path: pathname, value: r.ok ? r.data : null }))
      .catch(() => !stale && setCtx({ path: pathname, value: null }));
    return () => {
      stale = true;
    };
  }, [open, fresh, onEntity, pathname, ctxPath]);
  const context = onEntity && ctx?.path === pathname ? ctx.value : null;

  // ── server calls ──────────────────────────────────────────────────────────
  const begin = () => {
    busyRef.current = true;
    setBusy(true);
    setOutcome(null); // a new turn clears the last outcome
    setScanOpen(false);
  };
  const end = () => {
    busyRef.current = false;
    setBusy(false);
  };
  /** A refused or failed call, said by Cris in the box (never saved). */
  const fail = (res: Failure | null) => {
    const text = !res
      ? BROKEN_TEXT
      : res.kind === "validation"
        ? (Object.values(res.fieldErrors ?? {})[0] ?? res.message)
        : res.message;
    const m = localMessage("cris", text);
    setMessages((ms) => [...ms, m]);
    arrive([m]);
    setOutcome(res ? outcomeOfFailure(res.kind) : "error");
    setStatus("Ready");
  };

  const loadHistory = async (id: string) => {
    setHistory("loading");
    const res = await crisHistory({ conversationId: id }).catch(() => null);
    if (!res?.ok) {
      // Cris switched off since the page loaded (or not theirs): say so; a retry would only meet it again.
      if (res && (res.kind === "conflict" || res.kind === "forbidden")) {
        setHistory("ready");
        fail(res);
      } else setHistory("failed");
      return;
    }
    const got = res.data.messages;
    const ids = new Set(got.map((m) => m.id));
    setMessages((ms) => [...got, ...ms.filter((m) => !ids.has(m.id))]);
    setMore(res.data.more);
    setHistory("ready");
    setHistoryTick((t) => t + 1);
  };

  const send = async (body: SendBody, echo: string) => {
    if (busyRef.current) return;
    begin();
    const mine = localMessage("user", echo);
    setMessages((ms) => [...ms, mine]);
    const res = await crisSend({ ...(conversationId ? { conversationId } : {}), ...body, page: { path: pathname } }).catch(() => null);
    end();
    if (!res?.ok) return fail(res);
    const d = res.data;
    // A conversation moves on to a fresh one at 40 questions: adopt it (the old one's earlier pages are gone).
    if (d.conversationId && d.conversationId !== conversationId) {
      if (conversationId) setMore(false);
      setConversationId(d.conversationId);
    }
    setLeft(d.left);
    const saved = d.messages.some((m) => m.role === "user");
    setMessages((ms) => [...(saved ? ms.filter((m) => m.id !== mine.id) : ms), ...d.messages]);
    arrive(d.messages);
    setOutcome(outcomeOfMood(d.mood));
    setStatus(d.status);
  };

  const sendDraft = () => {
    const text = draft.trim();
    if (!text || busyRef.current) return;
    setDraft("");
    void send({ text }, text);
  };

  const scan = (tag: string) => {
    const assetId = scannedSpare(tag, messages);
    if (assetId) void send({ pick: { kind: "asset", assetId, scanned: true } }, `Scanned ${tag.trim().toUpperCase()}`);
    else void send({ text: tag }, tag);
  };

  const confirm = async (card: ConfirmCard) => {
    if (busyRef.current) return;
    begin();
    const res = await crisConfirm({ pendingId: card.pendingId }).catch(() => null);
    end();
    // Done, or refused for good (already done, expired, Cris off): the card closes. A clash at the same moment keeps it.
    if (pressSettled(res)) setConfirmed((s) => new Set(s).add(card.pendingId));
    if (!res?.ok) return fail(res);
    setMessages((ms) => [...ms, ...res.data.messages]);
    arrive(res.data.messages);
    // The action's own refusal (the spare was taken meanwhile): Frustrated, with the spares offered again.
    setOutcome(res.data.refused ? "error" : null);
    setStatus(res.data.refused ? "Ready" : "Done");
  };

  const undo = async (card: ResultCard) => {
    if (busyRef.current) return;
    begin();
    const res = await crisUndo({ pendingId: card.pendingId }).catch(() => null);
    end();
    // Done, or refused for good ("Something changed since…"): Undo goes from the card. A clash at the same moment keeps it.
    if (pressSettled(res)) setUndone((s) => new Set(s).add(card.pendingId));
    if (!res?.ok) return fail(res);
    setMessages((ms) => [...ms, ...res.data.messages]);
    arrive(res.data.messages);
    setOutcome(res.data.refused ? "error" : "undone");
    setStatus("Ready");
  };

  const newChat = async () => {
    if (busyRef.current) return;
    begin();
    const res = await crisNewChat().catch(() => null);
    end();
    if (!res?.ok) return fail(res);
    setConversationId(res.data.conversationId);
    setMessages([]);
    setMore(false);
    setHistory("ready");
    setQueue([]);
    setShown(0);
    setStatus("Ready");
    setConfirmed(new Set());
    setUndone(new Set());
    composerRef.current?.focus();
  };

  const earlier = async () => {
    const before = oldestSavedId(messages);
    if (!before || !conversationId || earlierRef.current) return;
    earlierRef.current = true;
    setEarlierLoading(true);
    const res = await crisHistory({ conversationId, before }).catch(() => null);
    earlierRef.current = false;
    setEarlierLoading(false);
    if (!res?.ok) return fail(res);
    const got = res.data.messages;
    setMessages((ms) => {
      const have = new Set(ms.map((m) => m.id));
      return [...got.filter((m) => !have.has(m.id)), ...ms];
    });
    setMore(res.data.more);
    setPrependTick((t) => t + 1);
    setHistoryTick((t) => t + 1);
  };

  const start = (s: QuickStart) => {
    if (s.send) return void send({ text: s.text }, s.text);
    // Cris needs more (who, which tag, why): start the sentence in the message box.
    setDraft(s.text);
    requestAnimationFrame(() => {
      const el = composerRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  };

  const actions: CardActions = {
    busy,
    confirmed,
    undone,
    now,
    firstFor: (pendingId) => personFirstFor(pendingId, messages),
    onPickPerson: (p: PersonRef) => void send({ pick: { kind: "person", employeeId: p.id } }, p.name),
    onPickSpare: (s) => void send({ pick: { kind: "asset", assetId: s.assetId, scanned: false } }, `Use ${s.tag}`),
    onMoreSpares: () => void send({ text: "None of these — show 3 more" }, "None of these — show 3 more"),
    onMoreStock: () => void send({ text: "Show 3 more" }, "Show 3 more"),
    onScan: () => {
      setScanOpen(true);
      setScanFocusTick((t) => t + 1);
    },
    onConfirm: (c) => void confirm(c),
    onChange: () => void send({ text: "Change" }, "Change"),
    onUndo: (c) => void undo(c),
    onChip: (text) => void send({ text }, text),
  };

  // ── open, close, drag, keys ───────────────────────────────────────────────
  const openBox = () => {
    openRef.current = true;
    setOpen(true);
    setUnread(0);
    setNow(Date.now());
    if (!seenHint) {
      setSeenHint(true);
      savePrefs({ seenHint: true });
    }
    if (history === "idle" && conversationId) void loadHistory(conversationId);
  };
  const closeBox = () => {
    openRef.current = false;
    setOpen(false);
    setScanOpen(false);
    mascotRef.current?.focus();
  };

  const settle = (next: { side: CrisSide; bottom: number }) => {
    clearTimeout(nudgeTimer.current); // an arrow-key save still waiting would put the old place back after this one
    setPos(next);
    savePrefs(next);
  };

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    skipClick.current = false;
    if (open || phone || e.button !== 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Capture is a nicety; the drag still works without it.
    }
    drag.current = { x: e.clientX, y: e.clientY, offsetX: e.clientX - r.left, offsetY: e.clientY - r.top, moved: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    // No button held: the capture was lost without a pointerup. End the drag rather than follow a hover.
    if (e.buttons === 0) return onPointerCancel();
    // A move of 6 px or more is a drag (and the click that follows it is not a press).
    if (!d.moved && Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) < 6) return;
    d.moved = true;
    clearTimeout(glideTimer.current);
    const at = dragPosition({ x: e.clientX, y: e.clientY }, d, { width: screenWidth(), height: screenHeight() }, CRIS_MASCOT);
    setDragAt({ ...at, live: true });
  };
  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    skipClick.current = true;
    // The click that ends a drag is dispatched straight after this pointerup; if a browser never sends it, the
    // flag must not swallow the next press (a keyboard Enter or Space).
    setTimeout(() => {
      skipClick.current = false;
    }, 0);
    const W = screenWidth();
    const H = screenHeight();
    const at = dragPosition({ x: e.clientX, y: e.clientY }, d, { width: W, height: H }, CRIS_MASCOT);
    const next = { side: snapSide(at.left, W, CRIS_MASCOT), bottom: bottomFromTop(at.top, H, CRIS_MASCOT) };
    // Glide to the side at the height dropped, then hand back to side/bottom placement (the same spot).
    setDragAt({
      left: next.side === "right" ? W - CRIS_INSET - CRIS_MASCOT : CRIS_INSET,
      top: H - CRIS_MASCOT - clampBottom(next.bottom, H, CRIS_MASCOT),
      live: false,
    });
    settle(next);
    glideTimer.current = setTimeout(() => setDragAt(null), DROP_GLIDE_MS);
  };
  const onPointerCancel = () => {
    drag.current = null;
    setDragAt(null);
  };
  const onClick = () => {
    if (skipClick.current) {
      skipClick.current = false;
      return;
    }
    if (open) closeBox();
    else openBox();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (open && e.key === "Escape") {
      e.preventDefault();
      closeBox();
      return;
    }
    // The arrow keys move the mascot only while the box is closed (and never on a phone, where it is fixed).
    if (open || phone) return;
    const H = screenHeight();
    const bottomNow = clampBottom(pos.bottom, H, CRIS_MASCOT);
    let next: { side: CrisSide; bottom: number } | null = null;
    if (e.key === "ArrowLeft") next = { side: "left", bottom: bottomNow };
    else if (e.key === "ArrowRight") next = { side: "right", bottom: bottomNow };
    else if (e.key === "ArrowUp") next = { side: pos.side, bottom: nudgeBottom(bottomNow, "up", H) };
    else if (e.key === "ArrowDown") next = { side: pos.side, bottom: nudgeBottom(bottomNow, "down", H) };
    if (!next) return;
    e.preventDefault();
    const target = next;
    setPos(target);
    clearTimeout(nudgeTimer.current);
    nudgeTimer.current = setTimeout(() => savePrefs(target), NUDGE_SAVE_MS);
  };

  if (!prefs.show) return null;

  // ── render ────────────────────────────────────────────────────────────────
  const bottom = clampBottom(pos.bottom, height, CRIS_MASCOT);
  const placement = boxPlacement({ side: pos.side, bottom, height, mascot: CRIS_MASCOT, big });
  const dockStyle: React.CSSProperties = dragAt ? { left: dragAt.left, top: dragAt.top } : { [pos.side]: CRIS_INSET, bottom };
  const waiting = waitingIn(messages, confirmed);
  const mood = moodFor({ open, busy: busy ? "model" : null, typing: typingId !== null, waiting, outcome, unread });
  const liveId = liveMessageId(messages);
  const live = messages.find((m) => m.id === liveId);
  const pickOpen = live?.role === "cris" && live.cards.some((c) => c.type === "spares");
  const showHint = !open && !seenHint && unread === 0 && !dragAt;
  const mascotLabel = open
    ? "Hide the chat with Cris"
    : `Chat with Cris${unread > 0 ? ` — ${unread} new ${unread === 1 ? "reply" : "replies"}` : ""}${phone ? "" : " (drag, or use the arrow keys, to move)"}`;

  return (
    // A labelled landmark of its own (outside <main>), so the box and the mascot are never content outside a region.
    <aside ref={dockRef} aria-label="Cris" className={cn("cris-dock print:hidden", dragAt?.live && "is-dragging")} style={dockStyle}>
      {open && (
        <CrisBox
          id={boxId}
          style={placement.css}
          above={placement.above}
          side={pos.side}
          big={big}
          firstName={firstName}
          status={busy ? "Thinking…" : status}
          busy={busy}
          messages={messages}
          typing={typingId ? { id: typingId, shown } : null}
          queued={new Set(queue.slice(1))}
          history={history === "idle" ? "ready" : history}
          more={more}
          context={context}
          starts={quickStarts(context)}
          actions={actions}
          draft={draft}
          placeholder={pickOpen ? "Type or scan a tag…" : "Ask Cris anything about equipment or people…"}
          left={left}
          scanOpen={scanOpen}
          prependTick={prependTick}
          historyTick={historyTick}
          bulkLoading={history === "loading" || earlierLoading}
          scanFocusTick={scanFocusTick}
          composerRef={composerRef}
          onDraft={setDraft}
          onSend={sendDraft}
          onScan={scan}
          onScanOpen={setScanOpen}
          onStart={start}
          onEarlier={() => void earlier()}
          onRetryHistory={() => conversationId && void loadHistory(conversationId)}
          onNewChat={() => void newChat()}
          onBig={() => setBig((b) => !b)}
          onClose={closeBox}
        />
      )}
      {showHint && (
        <div className="cris-hint" style={{ [pos.side]: CRIS_MASCOT + 2, bottom: 40 }}>
          Hi! Need a hand? <span className="text-[11px] text-fg-muted">· drag me anywhere</span>
        </div>
      )}
      <button
        ref={mascotRef}
        type="button"
        className={cn("cris-mascot", !open && !phone && "is-closed", dragAt?.live && "is-dragging")}
        aria-label={mascotLabel}
        aria-expanded={open}
        aria-controls={open ? boxId : undefined}
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onKeyDown={onKeyDown}
      >
        <CrisOrb color={resolveColor(prefs.color, theme)} mood={mood} motion={prefs.motion} size={110} decorative />
        {!open && unread > 0 && (
          <span className="cris-badge" aria-hidden>
            {unread}
          </span>
        )}
      </button>
    </aside>
  );
}
