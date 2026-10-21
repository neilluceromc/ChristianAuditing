"use client";

// The sign-in card (spec §5; Task 10's blob-style redesign): one "Welcome back" form posting to signInWithCredentials,
// then Sign up 1/2/3 as one form posting to signUp, so password managers see every field and the server sees exactly
// what it saw before. Inputs are controlled (React 19 resets uncontrolled fields after a form action, which would wipe
// the email on a wrong password) and carry no `required` (a hidden required field blocks submit); the client checks
// replace them, and Enter on Sign up 1 runs Continue instead of posting.
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/cn";
import { signInWithCredentials, signUp, type AuthFormState } from "@/server/auth/actions";
import { emailProblem, firstWord, segments, sequenceEmail, stepForField, type Step } from "./login-steps";

/** Staging quick sign-in: null when QUICK_LOGIN_EMAILS is unset (no STAGING pill). */
export type QuickSignIn = { accounts: { email: string; label: string }[]; refused: boolean } | null;

export type FieldKey = "email" | "password" | "name" | "newPassword";

/** What the card tells Cris (focus mode). */
export type CrisCue =
  | { kind: "engage"; field: FieldKey; el: HTMLInputElement }
  | { kind: "typing"; field: FieldKey; el: HTMLInputElement }
  | { kind: "field-blur"; field: FieldKey }
  /** The sign-in form lost focus with nothing typed: Cris goes back to her day. */
  | { kind: "leave" }
  | { kind: "error"; message: string }
  /** Sign-up is creating the account. */
  | { kind: "busy" };

/** A sign-in request in flight (credentials or Microsoft), for the signed-in sequence. */
export type SignInPending = { pending: boolean; email: string };

export type SignInCardProps = {
  step: Step;
  onStep: (s: Step) => void;
  domain: string | null;
  next?: string;
  microsoftAction: (() => Promise<void>) | null;
  viewerLanding: string;
  /** Focus the email field on load (`/login?step=login`). */
  autoFocus?: boolean;
  onCue?: (c: CrisCue) => void;
  onValues?: (v: { email: string; name: string }) => void;
  onSignIn?: (s: SignInPending) => void;
};

type Errors = Partial<Record<FieldKey, string>>;

export function SignInCard({
  step,
  onStep,
  domain,
  next,
  microsoftAction,
  viewerLanding,
  autoFocus,
  onCue,
  onValues,
  onSignIn,
}: SignInCardProps) {
  const uid = useId();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [showPassword, setShowPassword] = useState(false);
  const [caps, setCaps] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [msPending, setMsPending] = useState(false);
  const [ready, setReady] = useState(false);

  const [loginState, loginAction, loginPending] = useActionState<AuthFormState, FormData>(signInWithCredentials, {});
  const [signupState, signupAction, signupPending] = useActionState<AuthFormState, FormData>(signUp, {});

  // A new step starts with the password hidden and no Caps Lock hint.
  const [shownStep, setShownStep] = useState(step);
  if (shownStep !== step) {
    setShownStep(step);
    setShowPassword(false);
    setCaps(false);
  }

  const headingRef = useRef<HTMLHeadingElement>(null);
  const fieldRefs = {
    email: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
    name: useRef<HTMLInputElement>(null),
    newPassword: useRef<HTMLInputElement>(null),
  };
  /** The field to focus after the next step change instead of the heading (a server error on another step). */
  const focusAfterStep = useRef<FieldKey | null>(null);
  const focusedStep = useRef(step);
  // Effects and timers below read the latest values without re-running when they change.
  const latest = useRef({ step, onStep, onCue, email, password, pending: false, passwordSignIn: false });
  useEffect(() => {
    latest.current = { step, onStep, onCue, email, password, pending: loginPending || msPending, passwordSignIn: loginPending };
  });

  useEffect(() => {
    setReady(true);
    // Scrolled into view: where the stage stacks above the card, the form can start below the fold.
    if (autoFocus) fieldRefs.email.current?.focus();
    // Only on load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus the new step's heading (or a field a server error points at) when the step changes, never on first load.
  useEffect(() => {
    if (focusedStep.current === step) return;
    focusedStep.current = step;
    const target = focusAfterStep.current;
    focusAfterStep.current = null;
    (target ? fieldRefs[target].current : headingRef.current)?.focus({ preventScroll: true });
    // fieldRefs holds stable refs; only the step matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // The signed-in sequence follows the request exactly: on while it is in flight, off when it ends (an error). Declared
  // before the error effect below, so the sequence has ended by the time the error reaches Cris.
  // Only a password sign-in shows its typed email: Microsoft's account is picked at Microsoft (sequenceEmail).
  const signingIn = loginPending || msPending;
  useEffect(() => {
    onSignIn?.({ pending: signingIn, email: sequenceEmail(latest.current.passwordSignIn, latest.current.email) });
  }, [signingIn, onSignIn]);

  // A failed sign-in stays on the form with the message under Password.
  useEffect(() => {
    if (!loginState.error) return;
    setErrors({ password: loginState.error });
    fieldRefs.password.current?.focus({ preventScroll: true });
    latest.current.onCue?.({ kind: "error", message: loginState.error });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loginState]);

  // Sign-up: success shows "You're in"; an error moves to the step holding its field.
  useEffect(() => {
    if (signupState.created) {
      latest.current.onStep("signup-done");
      return;
    }
    if (!signupState.error) return;
    const field = signupState.field ?? "password";
    const key: FieldKey = field === "password" ? "newPassword" : field;
    setErrors({ [key]: signupState.error });
    const target = stepForField(field);
    if (target === latest.current.step) {
      fieldRefs[key].current?.focus({ preventScroll: true });
    } else {
      focusAfterStep.current = key;
      latest.current.onStep(target);
    }
    latest.current.onCue?.({ kind: "error", message: signupState.error });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signupState]);

  useEffect(() => {
    if (signupPending) latest.current.onCue?.({ kind: "busy" });
  }, [signupPending]);

  const cue = (c: CrisCue) => onCue?.(c);

  function go(to: Step) {
    setErrors({});
    onStep(to);
  }

  /** A real link that navigates before hydration; once hydrated a plain click changes the step in place. */
  const intercept = (to: Step) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    go(to);
  };

  /** Show a client-check failure under its field and move focus there (no scrolling). */
  function fail(key: FieldKey, message: string) {
    setErrors({ [key]: message });
    fieldRefs[key].current?.focus({ preventScroll: true });
    cue({ kind: "error", message });
  }

  function clearError(key: FieldKey) {
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function onLoginSubmit(e: React.FormEvent<HTMLFormElement>) {
    // Sign-in never checks the allowed domain (the server never has); only Sign up 1 does. Email first, then password.
    const problem = emailProblem(email, null);
    if (problem) {
      e.preventDefault();
      return fail("email", problem);
    }
    if (!password) {
      e.preventDefault();
      fail("password", "Enter your password.");
    }
  }

  function onSignupSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (step === "signup-name") {
      e.preventDefault();
      if (name.trim().length < 2) return fail("name", "Enter your name.");
      const problem = emailProblem(email, domain);
      if (problem) return fail("email", problem);
      go("signup-password");
      return;
    }
    if (newPassword.length < 10) {
      e.preventDefault();
      fail("newPassword", "Use at least 10 characters.");
    }
  }

  /** Leaving the untouched sign-in form (focus gone from the card) sends Cris back to her day. */
  function onLoginBlur() {
    setTimeout(() => {
      const l = latest.current;
      if (l.step !== "login" || l.email || l.password || l.pending) return;
      if (document.activeElement?.closest(".lw-card")) return;
      l.onCue?.({ kind: "leave" });
    }, 150);
  }

  const fieldEvents = (field: FieldKey) => ({
    onFocus: (e: React.FocusEvent<HTMLInputElement>) => cue({ kind: "engage", field, el: e.currentTarget }),
    onBlur: () => cue({ kind: "field-blur", field }),
  });
  const capsEvents = {
    onKeyDown: (e: React.KeyboardEvent) => setCaps(e.getModifierState("CapsLock")),
    onKeyUp: (e: React.KeyboardEvent) => setCaps(e.getModifierState("CapsLock")),
  };

  const segs = segments(step);
  const headingId = `${uid}-h-${step}`;
  const loginHref = next ? `/login?step=login&next=${encodeURIComponent(next)}` : "/login?step=login";
  const placeholder = `name@${domain ?? "company.com"}`;
  const heading = (text: string) => (
    <h1 id={headingId} ref={headingRef} tabIndex={-1} className="lw-h1">
      {text}
    </h1>
  );
  const nextInput = next ? <input type="hidden" name="next" value={next} /> : null;

  const emailField = (autoComplete: "username" | "email") => (
    <Field label="Work email" error={errors.email} icon={<MailIcon />}>
      {(p) => (
        <Input
          {...p}
          ref={fieldRefs.email}
          name="email"
          type="email"
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            clearError("email");
            cue({ kind: "typing", field: "email", el: e.currentTarget });
            onValues?.({ email: e.target.value, name });
          }}
          {...fieldEvents("email")}
          className="lw-inp lw-inp-ic"
        />
      )}
    </Field>
  );

  const passwordField = (key: "password" | "newPassword") => {
    const value = key === "password" ? password : newPassword;
    const forgotId = `${uid}-forgot`;
    return (
      <Field
        label="Password"
        error={errors[key]}
        caps={caps}
        icon={<LockIcon />}
        extraDescribedBy={key === "password" && forgotOpen ? forgotId : undefined}
        aside={
          key === "password" ? (
            <button
              type="button"
              className="lw-link lw-forgot"
              aria-expanded={forgotOpen}
              aria-controls={forgotId}
              onClick={() => setForgotOpen((o) => !o)}
            >
              Forgot password?
            </button>
          ) : null
        }
        after={
          key === "password" ? (
            <p id={forgotId} className="lw-hint" hidden={!forgotOpen}>
              Forgot your password? Ask an admin for help.
            </p>
          ) : null
        }
        trailing={(id) => (
          <button
            type="button"
            className="lw-show"
            aria-pressed={showPassword}
            aria-controls={id}
            onClick={() => setShowPassword((s) => !s)}
          >
            <EyeIcon off={showPassword} />
            {showPassword ? "Hide" : "Show"}
          </button>
        )}
      >
        {(p) => (
          <Input
            {...p}
            ref={fieldRefs[key]}
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete={key === "password" ? "current-password" : "new-password"}
            value={value}
            onChange={(e) => {
              (key === "password" ? setPassword : setNewPassword)(e.target.value);
              clearError(key);
            }}
            {...fieldEvents(key)}
            {...capsEvents}
            className="lw-inp lw-inp-ic lw-inp-pw"
          />
        )}
      </Field>
    );
  };

  return (
    <main
      className="lw-card"
      aria-labelledby={headingId}
      aria-busy={signingIn || undefined}
      data-login-ready={ready ? "true" : undefined}
    >
      {segs.length > 0 && (
        <div className="lw-segs" aria-hidden="true">
          {segs.map((s, i) => (
            <span key={i} className={cn("lw-seg", s && `lw-seg-${s}`)} />
          ))}
        </div>
      )}

      <section key={step} className="lw-step">
        {step === "login" && (
          <>
            <div className="lw-headblock">
              {heading("Welcome back")}
              <p className="lw-lede">Sign in to your Cris workspace.</p>
            </div>
            {microsoftAction && (
              <>
                <form action={microsoftAction}>
                  <MicrosoftButton onPending={setMsPending} />
                </form>
                <div className="lw-or" aria-hidden="true">
                  or sign in with email
                </div>
              </>
            )}
            <form action={loginAction} onSubmit={onLoginSubmit} onBlur={onLoginBlur} noValidate className="lw-stack">
              {nextInput}
              {emailField("username")}
              {passwordField("password")}
              <SubmitButton pending={loginPending} label="Log in" busyLabel="Logging in…" />
            </form>
            <p className="lw-foot lw-center">
              New to Cris?{" "}
              <a href="/signup" className="lw-link" onClick={intercept("signup-name")}>
                Create an account
              </a>
            </p>
            {domain && (
              <p className="lw-domain lw-center">
                <ShieldIcon />
                Access is limited to @{domain} accounts.
              </p>
            )}
          </>
        )}

        {(step === "signup-name" || step === "signup-password") && (
          <>
            {step === "signup-name" ? (
              <StepHead label="Sign up · 1 of 3" back="Back to sign in" onBack={() => go("login")} />
            ) : (
              <StepHead
                label="Sign up · 2 of 3"
                back="Back to your name and email"
                onBack={() => go("signup-name")}
                disabled={signupPending}
              />
            )}
            {heading(step === "signup-name" ? "Create your account" : "Choose a password")}
            <form action={signupAction} onSubmit={onSignupSubmit} noValidate className="lw-stack">
              <div hidden={step !== "signup-name"} className="lw-stack">
                <Field label="Full name" error={errors.name} icon={<PersonIcon />}>
                  {(p) => (
                    <Input
                      {...p}
                      ref={fieldRefs.name}
                      name="name"
                      autoComplete="name"
                      placeholder="Juan dela Cruz"
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        clearError("name");
                        cue({ kind: "typing", field: "name", el: e.currentTarget });
                        onValues?.({ email, name: e.target.value });
                      }}
                      {...fieldEvents("name")}
                      className="lw-inp lw-inp-ic"
                    />
                  )}
                </Field>
                {emailField("email")}
              </div>
              <div hidden={step !== "signup-password"} className="lw-stack">
                {passwordField("newPassword")}
                <div className={cn("lw-meter", newPassword.length >= 10 && "lw-ok")} aria-hidden="true">
                  <span style={{ width: `${Math.min(100, newPassword.length * 6.25)}%` }} />
                </div>
                <ul className="lw-rules">
                  <li className={newPassword.length >= 10 ? "lw-ok" : undefined}>
                    <span className="lw-rule-mark" aria-hidden="true">
                      {newPassword.length >= 10 ? "✓" : "○"}
                    </span>
                    At least 10 characters
                  </li>
                </ul>
              </div>
              {step === "signup-name" ? (
                <Button type="submit" variant="primary" className="lw-btn">
                  Continue
                  <ArrowIcon />
                </Button>
              ) : (
                <SubmitButton pending={signupPending} label="Create account" busyLabel="Creating account…" />
              )}
            </form>
            {step === "signup-name" && (
              <p className="lw-foot">
                Already have an account?{" "}
                <a href={loginHref} className="lw-link" onClick={intercept("login")}>
                  Log in
                </a>
              </p>
            )}
          </>
        )}

        {step === "signup-done" && (
          <>
            <div className="lw-stephead">
              <span />
              <span className="lw-stepno">Sign up · 3 of 3</span>
            </div>
            <div className="lw-okmark">
              <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m6 12.5 4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            {signupState.pendingApproval ? (
              <>
                {heading("Account created")}
                <p className="lw-lede">An admin needs to approve it before you can sign in.</p>
                <a href={loginHref} className="lw-btn lw-btn-link" onClick={intercept("login")}>
                  Back to sign in
                </a>
              </>
            ) : (
              <>
                {heading(firstWord(name) ? `You're in, ${firstWord(name)}` : "You're in")}
                <p className="lw-lede">
                  New accounts start as <strong className="lw-rolechip">Viewer</strong>. An admin assigns your role, which
                  decides the workspaces you can open. You&apos;ll start on Home.
                </p>
                <a href={viewerLanding} className="lw-btn lw-btn-link">
                  Go to Cris
                </a>
              </>
            )}
          </>
        )}
      </section>
    </main>
  );
}

/**
 * A labelled field: label row (with an optional control beside the label), the input behind its icon (plus an optional
 * trailing button), the Caps Lock hint and an always-present polite error region (spec §8: the region exists before
 * the message so it is announced).
 */
function Field({
  label,
  error,
  caps,
  icon,
  aside,
  after,
  trailing,
  extraDescribedBy,
  children,
}: {
  label: string;
  error?: string;
  caps?: boolean;
  icon: React.ReactNode;
  aside?: React.ReactNode;
  after?: React.ReactNode;
  trailing?: (id: string) => React.ReactNode;
  extraDescribedBy?: string;
  children: (p: { id: string; "aria-describedby"?: string; invalid: boolean }) => React.ReactNode;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const capsId = `${id}-caps`;
  const describedBy =
    [error ? errorId : null, caps ? capsId : null, extraDescribedBy ?? null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="lw-field">
      <div className="lw-labelrow">
        <label htmlFor={id} className="lw-label">
          {label}
        </label>
        {aside}
      </div>
      <div className={cn("lw-iw", trailing && "lw-pw")}>
        {icon}
        {children({ id, "aria-describedby": describedBy, invalid: !!error })}
        {trailing?.(id)}
      </div>
      {caps !== undefined && (
        <p id={capsId} className="lw-caps" hidden={!caps}>
          Caps Lock is on.
        </p>
      )}
      {after}
      <p id={errorId} className="lw-err" aria-live="polite">
        {error && <AlertIcon />}
        {error}
      </p>
    </div>
  );
}

function StepHead({
  label,
  back,
  onBack,
  disabled,
}: {
  label: string;
  back: string;
  onBack: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="lw-stephead">
      <button type="button" className="lw-back" aria-label={back} onClick={onBack} disabled={disabled}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M10 3.5 5.5 8 10 12.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back
      </button>
      <span className="lw-stepno">{label}</span>
    </div>
  );
}

/** The primary submit: a spinner and the "…ing" label while the action runs (the kit's `loading` hides the label). */
function SubmitButton({ pending, label, busyLabel }: { pending: boolean; label: string; busyLabel: string }) {
  return (
    <Button type="submit" variant="primary" className="lw-btn" disabled={pending} aria-busy={pending || undefined}>
      {pending ? (
        <>
          <span className="lw-spin" aria-hidden="true" />
          {busyLabel}
        </>
      ) : (
        label
      )}
    </Button>
  );
}

/** Continue with Microsoft; reports its form's pending state (the full-page OAuth redirect starting). */
function MicrosoftButton({ onPending }: { onPending: (p: boolean) => void }) {
  const { pending } = useFormStatus();
  useEffect(() => onPending(pending), [pending, onPending]);
  return (
    <Button type="submit" variant="secondary" className="lw-btn2 lw-sso" disabled={pending}>
      <MicrosoftIcon />
      Continue with Microsoft
    </Button>
  );
}

const ic = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

function MailIcon() {
  return (
    <svg className="lw-ic" {...ic}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg className="lw-ic" {...ic}>
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function PersonIcon() {
  return (
    <svg className="lw-ic" {...ic}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </svg>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  return (
    <svg {...ic}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {off && <path d="m3 3 18 18" />}
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg {...ic} width={13} height={13}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg {...ic} width={14} height={14} strokeWidth={2}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg {...ic} strokeWidth={2}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      {[
        [1, 1],
        [8.5, 1],
        [1, 8.5],
        [8.5, 8.5],
      ].map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="6.5" height="6.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" />
      ))}
    </svg>
  );
}
