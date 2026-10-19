"use client";

// The stepped sign-in card (spec §5): Welcome → Log in 1/2 or Sign up 1/2/3. Log in 1+2 are one form posting to
// signInWithCredentials and Sign up 1+2 one form posting to signUp, so password managers see every field and the
// server sees exactly what it saw before. Inputs are controlled (React 19 resets uncontrolled fields after a form
// action, which would wipe the hidden email on a wrong password) and carry no `required` (a hidden required field
// blocks submit); the client checks replace them, and Enter on a first step runs Continue instead of posting.
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/cn";
import { quickSignIn, signInWithCredentials, signUp, type AuthFormState } from "@/server/auth/actions";
import { STEP_PROGRESS, emailProblem, firstWord, initials, isBackward, stepForField, type Step } from "./login-steps";

/** Staging quick sign-in: null when QUICK_LOGIN_EMAILS is unset (the section is not shown). */
export type QuickSignIn = { accounts: { email: string; label: string }[]; refused: boolean } | null;

/** What the card tells Cris (focus mode, Task 7). */
export type CrisCue =
  | { kind: "typing" }
  | { kind: "password-focus"; on: boolean }
  | { kind: "error"; message: string }
  | { kind: "pending" };

export type SignInCardProps = {
  step: Step;
  onStep: (s: Step) => void;
  domain: string | null;
  next?: string;
  microsoftAction: (() => Promise<void>) | null;
  quick: QuickSignIn;
  viewerLanding: string;
  onCue?: (c: CrisCue) => void;
  onValues?: (v: { email: string; name: string }) => void;
};

type FieldKey = "email" | "password" | "name" | "newPassword";
type Errors = Partial<Record<FieldKey, string>>;

const QUICK_REFUSED = "That quick sign-in is not available — the account is missing or disabled.";

export function SignInCard({
  step,
  onStep,
  domain,
  next,
  microsoftAction,
  quick,
  viewerLanding,
  onCue,
  onValues,
}: SignInCardProps) {
  const uid = useId();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [showPassword, setShowPassword] = useState(false);
  const [caps, setCaps] = useState(false);
  const [quickEmail, setQuickEmail] = useState(quick?.accounts[0]?.email ?? "");
  const [ready, setReady] = useState(false);

  const [loginState, loginAction, loginPending] = useActionState<AuthFormState, FormData>(signInWithCredentials, {});
  const [signupState, signupAction, signupPending] = useActionState<AuthFormState, FormData>(signUp, {});

  // Slide direction for the step that just appeared (none on first render).
  const [shownStep, setShownStep] = useState(step);
  const [slide, setSlide] = useState<"" | "lw-enter" | "lw-enter-back">("");
  if (shownStep !== step) {
    setShownStep(step);
    setSlide(isBackward(shownStep, step) ? "lw-enter-back" : "lw-enter");
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
  // Effects below read the latest props without re-running when they change.
  const latest = useRef({ step, onStep, onCue });
  useEffect(() => {
    latest.current = { step, onStep, onCue };
  });

  useEffect(() => setReady(true), []);

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

  // A failed sign-in stays on Log in 2 with the message under Password.
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

  const pending = loginPending || signupPending;
  useEffect(() => {
    if (pending) latest.current.onCue?.({ kind: "pending" });
  }, [pending]);

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

  function changeEmail(value: string) {
    setEmail(value);
    clearError("email");
    cue({ kind: "typing" });
    onValues?.({ email: value, name });
  }

  function changeName(value: string) {
    setName(value);
    clearError("name");
    cue({ kind: "typing" });
    onValues?.({ email, name: value });
  }

  function onLoginSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (step === "login-email") {
      e.preventDefault();
      // Log in never checks the allowed domain (the server never has); only Sign up 1 does.
      const problem = emailProblem(email, null);
      if (problem) return fail("email", problem);
      go("login-password");
      return;
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

  const passwordEvents = {
    onFocus: () => cue({ kind: "password-focus", on: true }),
    onBlur: () => cue({ kind: "password-focus", on: false }),
    onKeyDown: (e: React.KeyboardEvent) => setCaps(e.getModifierState("CapsLock")),
    onKeyUp: (e: React.KeyboardEvent) => setCaps(e.getModifierState("CapsLock")),
  };

  const progress = STEP_PROGRESS[step];
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
    <CardField label="Work email" error={errors.email}>
      {(p) => (
        <Input
          {...p}
          ref={fieldRefs.email}
          name="email"
          type="email"
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={email}
          onChange={(e) => changeEmail(e.target.value)}
          className="lw-inp"
        />
      )}
    </CardField>
  );

  const passwordField = (key: "password" | "newPassword") => {
    const value = key === "password" ? password : newPassword;
    return (
      <CardField label="Password" error={errors[key]} caps={caps}>
        {(p) => (
          <div className="lw-pw">
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
              {...passwordEvents}
              className="lw-inp"
            />
            <button
              type="button"
              className="lw-show"
              aria-pressed={showPassword}
              aria-controls={p.id}
              onClick={() => setShowPassword((s) => !s)}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
        )}
      </CardField>
    );
  };

  return (
    <main
      className={cn("lw-card", progress === 0 && "lw-noprog")}
      aria-labelledby={headingId}
      data-login-ready={ready ? "true" : undefined}
    >
      <div className="lw-brandrow">
        <span className="lw-wordmark">Cris</span>
        <span className="lw-brandtag font-mono">IT inventory</span>
      </div>
      <div className="lw-progress" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>

      <section key={step} className={cn("lw-step", slide)}>
        {step === "welcome" && (
          <>
            {heading("Welcome to Cris")}
            <p className="lw-lede">Laptops, headsets, purchases and leavers, tracked in one place.</p>
            <div className="lw-tiles">
              <a href={loginHref} className="lw-tile lw-tile-primary" onClick={intercept("login-email")}>
                <span className="lw-tile-t">Log in</span>
                <span className="lw-tile-s">I already have an account</span>
                <Chevron />
              </a>
              <a href="/signup" className="lw-tile" onClick={intercept("signup-name")}>
                <span className="lw-tile-t">Sign up</span>
                <span className="lw-tile-s">I&apos;m new to Cris</span>
                <Chevron />
              </a>
            </div>
            {microsoftAction && (
              <>
                <div className="lw-or font-mono" aria-hidden="true">
                  OR
                </div>
                <form action={microsoftAction}>
                  <Button type="submit" variant="secondary" className="lw-btn2 w-full">
                    <MicrosoftIcon />
                    Continue with Microsoft
                  </Button>
                </form>
              </>
            )}
            {quick && (
              <section className="lw-quick" aria-labelledby={`${uid}-quick`}>
                <div className="lw-qhead">
                  <h2 id={`${uid}-quick`} className="lw-qtitle">
                    Quick sign-in
                  </h2>
                  <span className="lw-pill font-mono">Staging</span>
                </div>
                <p className="lw-qhint">One click, no password. Turned on for this server only.</p>
                {quick.refused && <Banner tone="fault" title={QUICK_REFUSED} />}
                {quick.accounts.length === 0 ? (
                  <p className="lw-qhint">None of the listed accounts exists or is enabled.</p>
                ) : (
                  <form action={quickSignIn} className="lw-qform">
                    {nextInput}
                    <div className="lw-qrow">
                      <label htmlFor={`${uid}-qs`} className="sr-only">
                        Account
                      </label>
                      <Select
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
                      <Button type="submit" variant="secondary" className="lw-btn2">
                        Continue
                      </Button>
                    </div>
                    <p className="lw-qwho font-mono">{quickEmail}</p>
                  </form>
                )}
              </section>
            )}
            {domain && <p className="lw-domain">Access is limited to @{domain} accounts.</p>}
          </>
        )}

        {(step === "login-email" || step === "login-password") && (
          <>
            {step === "login-email" ? (
              <StepHead label="Log in · 1 of 2" back="Back to the start" onBack={() => go("welcome")} />
            ) : (
              <StepHead label="Log in · 2 of 2" back="Back to your email" onBack={() => go("login-email")} />
            )}
            {heading(step === "login-email" ? "What's your work email?" : "Enter your password")}
            {step === "login-password" && (
              <div className="lw-who">
                <span className="lw-avatar font-mono" aria-hidden="true">
                  {initials(email)}
                </span>
                <span className="lw-who-e">{email.trim()}</span>
                <button type="button" className="lw-link" onClick={() => go("login-email")}>
                  Change
                </button>
              </div>
            )}
            <form action={loginAction} onSubmit={onLoginSubmit} noValidate className="lw-stack">
              {nextInput}
              <div hidden={step !== "login-email"}>{emailField("username")}</div>
              <div hidden={step !== "login-password"}>{passwordField("password")}</div>
              {step === "login-email" ? (
                <Button type="submit" variant="primary" className="lw-btn">
                  Continue
                </Button>
              ) : (
                <SubmitButton pending={loginPending} label="Log in" busyLabel="Logging in…" />
              )}
            </form>
            {step === "login-email" ? (
              <p className="lw-foot">
                New to Cris?{" "}
                <a href="/signup" className="lw-link" onClick={intercept("signup-name")}>
                  Sign up
                </a>
              </p>
            ) : (
              <p className="lw-foot">Forgot your password? Ask an admin for help.</p>
            )}
          </>
        )}

        {(step === "signup-name" || step === "signup-password") && (
          <>
            {step === "signup-name" ? (
              <StepHead label="Sign up · 1 of 3" back="Back to the start" onBack={() => go("welcome")} />
            ) : (
              <StepHead label="Sign up · 2 of 3" back="Back to your name and email" onBack={() => go("signup-name")} />
            )}
            {heading(step === "signup-name" ? "Create your account" : "Choose a password")}
            <form action={signupAction} onSubmit={onSignupSubmit} noValidate className="lw-stack">
              <div hidden={step !== "signup-name"} className="lw-stack">
                <CardField label="Full name" error={errors.name}>
                  {(p) => (
                    <Input
                      {...p}
                      ref={fieldRefs.name}
                      name="name"
                      autoComplete="name"
                      placeholder="Juan dela Cruz"
                      value={name}
                      onChange={(e) => changeName(e.target.value)}
                      className="lw-inp"
                    />
                  )}
                </CardField>
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
                </Button>
              ) : (
                <SubmitButton pending={signupPending} label="Create account" busyLabel="Creating account…" />
              )}
            </form>
            {step === "signup-name" && (
              <p className="lw-foot">
                Already have an account?{" "}
                <a href={loginHref} className="lw-link" onClick={intercept("login-email")}>
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
              <span className="lw-stepno font-mono">Sign up · 3 of 3</span>
            </div>
            <div className="lw-okmark">
              <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
                <path d="m6 12.5 4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            {heading(firstWord(name) ? `You're in, ${firstWord(name)}` : "You're in")}
            <p className="lw-lede">
              New accounts start as <strong className="lw-rolechip">Viewer</strong>. An admin assigns your role, and your role
              decides which workspace you land in.
            </p>
            <a href={viewerLanding} className="lw-btn lw-btn-link">
              Go to Cris
            </a>
          </>
        )}
      </section>
    </main>
  );
}

/**
 * A FormField whose control is followed by the Caps Lock hint and an always-present polite error region
 * (spec §8: errors are aria-live="polite"; the region exists before the message so it is announced).
 */
function CardField({
  label,
  error,
  caps,
  children,
}: {
  label: string;
  error?: string;
  caps?: boolean;
  children: (p: { id: string; "aria-describedby"?: string; invalid: boolean }) => React.ReactNode;
}) {
  return (
    <FormField label={label}>
      {({ id }) => {
        const errorId = `${id}-error`;
        const capsId = `${id}-caps`;
        const describedBy = [error ? errorId : null, caps ? capsId : null].filter(Boolean).join(" ") || undefined;
        return (
          <div className="lw-control">
            {children({ id, "aria-describedby": describedBy, invalid: !!error })}
            {caps !== undefined && (
              <p id={capsId} className="lw-caps" hidden={!caps}>
                Caps Lock is on.
              </p>
            )}
            <p id={errorId} className="lw-err" aria-live="polite">
              {error}
            </p>
          </div>
        );
      }}
    </FormField>
  );
}

function StepHead({ label, back, onBack }: { label: string; back: string; onBack: () => void }) {
  return (
    <div className="lw-stephead">
      <button type="button" className="lw-back" aria-label={back} onClick={onBack}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M10 3.5 5.5 8 10 12.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Back
      </button>
      <span className="lw-stepno font-mono">{label}</span>
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

function Chevron() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path d="M7 4.5 11.5 9 7 13.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
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
