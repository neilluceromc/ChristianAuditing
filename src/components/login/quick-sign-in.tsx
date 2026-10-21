"use client";

// Staging quick sign-in, tucked into the corner (Task 10's redesign): a dashed STAGING pill that opens a glass
// popover with the same section as before — the hint, the refused banner, the "None of the listed accounts" state or
// the account picker, and `next`. Only rendered when QUICK_LOGIN_EMAILS lists accounts. A refused attempt
// (`?quick=refused`) opens it on load so the banner shows; Escape or × closes it and returns focus to the pill.
import { useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { quickSignIn } from "@/server/auth/actions";
import type { QuickSignIn as QuickSignInProps } from "./sign-in-card";

const QUICK_REFUSED = "That quick sign-in is not available — the account is missing or disabled.";

export function QuickSignIn({
  quick,
  next,
  onSignIn,
}: {
  quick: NonNullable<QuickSignInProps>;
  next?: string;
  onSignIn?: (s: { pending: boolean; email: string }) => void;
}) {
  const uid = useId();
  const [open, setOpen] = useState(quick.refused);
  const [quickEmail, setQuickEmail] = useState(quick.accounts[0]?.email ?? "");
  const pillRef = useRef<HTMLButtonElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const opened = useRef(false);
  const popId = `${uid}-quick`;
  const headId = `${uid}-quick-h`;

  // Opened by the pill: move into the picker. Opened on load (refused): leave focus where it is.
  useEffect(() => {
    if (open && opened.current) selectRef.current?.focus({ preventScroll: true });
  }, [open]);

  const close = () => {
    setOpen(false);
    pillRef.current?.focus({ preventScroll: true });
  };

  return (
    <div className="lw-staging">
      {open && (
        <section
          id={popId}
          className="lw-quick lw-quickpop"
          aria-labelledby={headId}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
          }}
        >
          <div className="lw-qhead">
            <h2 id={headId} className="lw-qtitle">
              Quick sign-in
            </h2>
            <span className="lw-pill">Staging</span>
            <button type="button" className="lw-x" aria-label="Close quick sign-in" onClick={close}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="lw-qhint">One click, no password. Turned on for this server only.</p>
          {quick.refused && <Banner tone="fault" title={QUICK_REFUSED} />}
          {quick.accounts.length === 0 ? (
            <p className="lw-qhint">None of the listed accounts exists or is enabled.</p>
          ) : (
            <form action={quickSignIn} className="lw-qform">
              {next ? <input type="hidden" name="next" value={next} /> : null}
              <div className="lw-qrow">
                <label htmlFor={`${uid}-qs`} className="sr-only">
                  Account
                </label>
                <Select
                  ref={selectRef}
                  id={`${uid}-qs`}
                  name="email"
                  value={quickEmail}
                  onChange={(e) => setQuickEmail(e.target.value)}
                  className="lw-inp"
                >
                  {quick.accounts.map((a) => (
                    <option key={a.email} value={a.email}>
                      {a.label}
                    </option>
                  ))}
                </Select>
                <QuickSubmit email={quickEmail} onSignIn={onSignIn} />
              </div>
              <p className="lw-qwho">{quickEmail}</p>
            </form>
          )}
        </section>
      )}
      <button
        ref={pillRef}
        type="button"
        className="lw-secret"
        aria-expanded={open}
        aria-controls={popId}
        onClick={() => {
          opened.current = true;
          setOpen((o) => !o);
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 3h6M10 3v6L4.5 18.5A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-2.5L14 9V3" />
          <path d="M7 15h10" />
        </svg>
        Staging
      </button>
    </div>
  );
}

/** Continue, reporting the quick sign-in in flight for the signed-in sequence. */
function QuickSubmit({ email, onSignIn }: { email: string; onSignIn?: (s: { pending: boolean; email: string }) => void }) {
  const { pending } = useFormStatus();
  const latest = useRef(email);
  useEffect(() => {
    latest.current = email;
  });
  useEffect(() => {
    onSignIn?.({ pending, email: latest.current });
  }, [pending, onSignIn]);
  return (
    <Button type="submit" variant="secondary" className="lw-btn2">
      Continue
    </Button>
  );
}
