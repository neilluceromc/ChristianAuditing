import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ConfirmCard, CrisCard, ResultCard, SparesCard, StockCard } from "@/lib/cris-cards";
import { CrisCardView, type CardActions } from "./cris-cards";
import { CrisBox, type BoxProps } from "./cris-box";

/* Markup only (no DOM in vitest here): the cards' words and which controls show when. */

const noop = () => undefined;
const actions = (over: Partial<CardActions> = {}): CardActions => ({
  busy: false, confirmed: new Set(), undone: new Set(), now: Date.parse("2026-10-17T02:00:00.000Z"),
  firstFor: () => "Ana",
  onPickPerson: noop, onPickSpare: noop, onMoreSpares: noop, onMoreStock: noop, onScan: noop, onConfirm: noop, onChange: noop, onUndo: noop, onChip: noop,
  ...over,
});
const person = { id: "e1", name: "Ana Reyes", employeeNo: "EMP-0101", worksFor: "Bluepeak Telecom", initials: "AR" };
const gets = {
  assetId: "a230", tag: "BR-LT-0230", model: "Latitude 5440", typeName: "Standard",
  warrantyEnd: "2029-02-10T00:00:00.000Z", backOn: null, serial: "5CG4812", scanned: true,
};
const replace: ConfirmCard = {
  type: "confirm", pendingId: "p1", kind: "replace", person, gets,
  returns: { assetId: "a201", tag: "BR-LT-0201", outcome: "DEFECTIVE", reason: "the screen is cracked" },
};
const html = (card: CrisCard, live = true, a = actions()) => renderToStaticMarkup(<CrisCardView card={card} live={live} actions={a} />);

describe("the Confirm card (spec §4)", () => {
  it("shows the person, what they get and what goes back, and the two buttons", () => {
    const out = html(replace);
    expect(out).toContain("Check before you confirm");
    expect(out).toContain("Ana Reyes");
    expect(out).toContain("EMP-0101 · Bluepeak Telecom");
    expect(out).toContain("BR-LT-0230");
    expect(out).toContain("SN 5CG4812");
    expect(out).toContain("Scanned ✓");
    expect(out).toContain("BR-LT-0201");
    expect(out).toContain("Defective");
    expect(out).toContain("the screen is cracked");
    expect(out).toContain("Confirm replacement");
    expect(out).toContain("Change");
    expect(out).toContain("Cris checks everything again the moment you confirm.");
  });
  it("an assignment shows its reason", () => {
    const out = html({ ...replace, kind: "assign", returns: undefined, reason: "new starter" });
    expect(out).toContain("Confirm assignment");
    expect(out).toContain("new starter");
    expect(out).not.toContain("Returns");
  });
  it("has no buttons once confirmed, or when it is not the newest message", () => {
    expect(html(replace, true, actions({ confirmed: new Set(["p1"]) }))).not.toContain("Confirm replacement");
    expect(html(replace, false)).not.toContain("Confirm replacement");
  });
});

describe("the result card", () => {
  const result: ResultCard = {
    type: "result", pendingId: "p1", employeeId: "e1", head: "Replaced.", text: "Ana Reyes has BR-LT-0230 now.",
    undoUntil: "2026-10-17T02:00:42.000Z",
  };
  it("counts Undo down, links the profile and suggests the form", () => {
    const out = html(result);
    expect(out).toContain("Replaced.");
    expect(out).toContain("Undo");
    expect(out).toContain("· 42 s");
    expect(out).toContain('href="/employees/e1"');
    expect(out).toContain('href="/employees/e1/form"');
    expect(out).toContain("Print Ana&#x27;s accountability form");
  });
  it("hides Undo after it ran, and once the minute is up", () => {
    expect(html(result, true, actions({ undone: new Set(["p1"]) }))).not.toContain("Undo");
    expect(html(result, true, actions({ now: Date.parse("2026-10-17T02:01:00.000Z") }))).not.toContain("Undo");
  });
});

describe("the spare pick list", () => {
  const spares: SparesCard = {
    type: "spares", employeeId: "e1", offset: 0, more: true,
    options: [{ assetId: "a230", tag: "BR-LT-0230", model: "Latitude 5440", typeName: "Standard", warrantyEnd: null, backOn: null }],
  };
  it("is a radio list with Use, Scan its label and show 3 more while live", () => {
    const out = html(spares);
    expect(out).toContain('type="radio"');
    expect(out).toContain("Pick one above");
    expect(out).toContain("Scan its label");
    expect(out).toContain("None of these — show 3 more");
  });
  it("is a record once a newer message follows", () => {
    const out = html(spares, false);
    expect(out).toContain("BR-LT-0230");
    expect(out).not.toContain("Scan its label");
    expect(out).toContain("disabled");
  });
});

describe("the box", () => {
  const box = (over: Partial<BoxProps> = {}) => renderToStaticMarkup(
    <CrisBox
      id="b" style={{}} above side="right" big={false} firstName="Neil" status="Ready" busy={false} messages={[]}
      typing={null} queued={new Set()} history="ready" more={false} context={null} starts={[]} actions={actions()}
      draft="" placeholder="Ask" left={94} scanOpen={false} scanFocusTick={0} prependTick={0} historyTick={0} bulkLoading={false} composerRef={{ current: null }}
      onDraft={noop} onSend={noop} onScan={noop} onScanOpen={noop} onStart={noop} onEarlier={noop}
      onRetryHistory={noop} onNewChat={noop} onBig={noop} onClose={noop}
      {...over}
    />,
  );
  it("opens on the greeting, with a polite log and the footer count", () => {
    const out = box();
    expect(out).toContain('role="dialog"');
    expect(out).toContain('aria-label="Chat with Cris"');
    expect(out).toContain('role="log"');
    expect(out).toContain('aria-live="polite"');
    expect(out).toContain("Hi Neil — what do you need?");
    expect(out).toContain("I can look things up and make changes. Every change waits for your Confirm.");
    expect(out).toContain("94 questions left today");
    expect(out).toContain('class="cris-box cris-above cris-r"');
  });
  it("shows the context chip on a profile", () => {
    const out = box({ context: { kind: "person", id: "e1", name: "Ana Reyes" } });
    expect(out).toContain("You&#x27;re on <b");
    expect(out).toContain("Ana Reyes</b>&#x27;s profile");
  });
  it("types a reply out for the eyes, and gives the log the whole text once", () => {
    const out = box({
      messages: [{ id: "m1", role: "cris", text: "Ana Reyes has 3 items:", cards: [], at: "2026-10-17T02:00:00.000Z" }],
      typing: { id: "m1", shown: 6 },
    });
    expect(out).toContain('<span class="sr-only">Ana Reyes has 3 items:</span>');
    expect(out).toContain('<span aria-hidden="true">Ana Re<span class="cris-caret"></span></span>');
  });
  it("keeps the same shape once typed, so the screen-reader copy is never re-inserted (announced once)", () => {
    const m = { id: "m1", role: "cris" as const, text: "Ana Reyes has 3 items:", cards: [], at: "2026-10-17T02:00:00.000Z" };
    const typing = box({ messages: [m], typing: { id: "m1", shown: 6 } });
    const done = box({ messages: [m], typing: null });
    const sr = '<span class="sr-only">Ana Reyes has 3 items:</span>';
    expect(typing).toContain(sr);
    expect(done).toContain(sr);
    expect(done).toContain('<span aria-hidden="true">Ana Reyes has 3 items:</span>');
  });
  it("marks the log busy while history loads, so the bulk insert is not read aloud", () => {
    expect(box({ bulkLoading: true })).toContain('aria-busy="true"');
    expect(box()).not.toContain("aria-busy");
  });
  it("has the scan button and no Preview pill when live", () => {
    const out = box();
    expect(out).toContain('aria-label="Scan a tag"');
    expect(out).not.toContain("Preview");
  });
  it("in preview (no key): a Preview pill by the name, the preview greeting, no context chip and no scan button", () => {
    const out = box({ preview: true, context: { kind: "person", id: "e1", name: "Ana Reyes" } });
    expect(out).toMatch(/>Cris<\/div><span[^>]*>Preview<\/span>/);
    expect(out).toContain("Hi Neil — what do you need?");
    expect(out).toContain("I&#x27;m still in development — for now I can only chat. Soon I&#x27;ll look things up and make changes for you.");
    expect(out).not.toContain("I can look things up and make changes.");
    expect(out).not.toContain("Ana Reyes");
    expect(out).not.toContain("Scan a tag");
    expect(out).toContain("94 questions left today");
  });
});

describe("the stock card (final review I2: spare laptops in stock)", () => {
  const stock: StockCard = {
    type: "stock", offset: 0, more: true,
    options: [
      { assetId: "a230", tag: "BR-LT-0230", model: "Latitude 5440", typeName: "Standard", warrantyEnd: "2029-02-10T00:00:00.000Z", backOn: null },
      { assetId: "a231", tag: "BR-LT-0231", model: "Latitude 5440", typeName: "Standard", warrantyEnd: null, backOn: null },
    ],
  };
  it("is a plain list with no pick controls, and Show 3 more while live", () => {
    const out = html(stock);
    expect(out).toContain("BR-LT-0230");
    expect(out).toContain("BR-LT-0231");
    expect(out).toContain("<ul");
    expect(out).toContain("Show 3 more");
    expect(out).not.toContain("type=\"radio\"");
    expect(out).not.toContain("Use ");
    expect(out).not.toContain("Scan its label");
    expect(out).not.toContain("Pick one above");
  });
  it("drops Show 3 more when it is not the newest, or when nothing more follows", () => {
    expect(html(stock, false)).not.toContain("Show 3 more");
    expect(html({ ...stock, more: false })).not.toContain("Show 3 more");
  });
  it("says so when nothing is in stock", () => {
    expect(html({ ...stock, options: [], more: false })).toContain("No spares in stock right now.");
  });
});
