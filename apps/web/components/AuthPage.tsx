"use client";

import Link from "next/link";
import { FormEvent, ReactNode, useState, useSyncExternalStore } from "react";
import { BrandMark } from "@/components/BrandMark";

type AuthPageProps = {
  mode: "login" | "register";
  title: ReactNode;
  subtitle: string;
  submitLabel: string;
  submittingLabel: string;
  footerText: string;
  footerHref: string;
  footerLabel: string;
};

function subscribeUrlChange(callback: () => void) {
  window.addEventListener("popstate", callback);
  window.addEventListener("hashchange", callback);

  return () => {
    window.removeEventListener("popstate", callback);
    window.removeEventListener("hashchange", callback);
  };
}

function getInviteSnapshot() {
  return new URLSearchParams(window.location.search).get("invite");
}

function getNextSnapshot() {
  return new URLSearchParams(window.location.search).get("next");
}

function getServerInviteSnapshot() {
  return null;
}

function getServerNextSnapshot() {
  return null;
}

export function AuthPage(props: AuthPageProps) {
  const isRegister = props.mode === "register";
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [registrationPassword, setRegistrationPassword] = useState("");
  const invite = useSyncExternalStore(subscribeUrlChange, getInviteSnapshot, getServerInviteSnapshot);
  const next = useSyncExternalStore(subscribeUrlChange, getNextSnapshot, getServerNextSnapshot);
  const footerParams = new URLSearchParams();
  if (invite) footerParams.set("invite", invite);
  if (next) footerParams.set("next", next);
  const footerQuery = footerParams.toString();
  const footerHref = footerQuery ? `${props.footerHref}?${footerQuery}` : props.footerHref;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const response = await fetch(`/api/auth/${props.mode}`, {
      body: JSON.stringify({
        email: formData.get("email"),
        name: formData.get("name"),
        password: formData.get("password"),
        username: formData.get("username"),
        identifier: formData.get("identifier")
      }),
      headers: { "content-type": "application/json" },
      method: "POST"
    });

    if (response.ok) {
      const body = await response.json() as { developmentCode?: string | null; emailVerificationRequired?: boolean };
      if (isRegister) {
        if (body.emailVerificationRequired === false) {
          window.location.href = "/onboarding";
          return;
        }
        if (body.developmentCode) window.sessionStorage.setItem("slate-development-verification-code", body.developmentCode);
        window.location.href = `/verify-email?email=${encodeURIComponent(String(formData.get("email") ?? ""))}`;
        return;
      }
      window.location.href = "/onboarding";
      return;
    }

    const message = await readAuthError(response);
    setError(message);
    setSubmitting(false);
  }

  return (
    <main className="auth-shell slate-auth monad-auth">
      <header className="auth-header">
        <div className="auth-header-inner">
          <BrandMark href="/" />
          <Link className="auth-back-link" href="/">
            Back to site <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </header>
      <section className="auth-main">
        <div className={`auth-experience auth-experience-${props.mode}`}>
          <div className="auth-panel">
            <div className="auth-kicker">{isRegister ? "New workspace" : "Welcome back"}</div>
            <h1>{props.title}</h1>
            <p>{props.subtitle}</p>
            <form className="auth-form" onSubmit={handleSubmit}>
              {isRegister && (
                <label>
                  <span>Name</span>
                  <input required name="name" type="text" placeholder="Ada Kim" />
                </label>
              )}
              {isRegister && (
                <label>
                  <span>Username</span>
                  <input autoCapitalize="none" autoComplete="username" maxLength={32} minLength={3} pattern="[A-Za-z0-9_-]+" required name="username" type="text" placeholder="ada-kim" />
                </label>
              )}
              {!isRegister && (
                <label>
                  <span>Email or username</span>
                  <input autoCapitalize="none" autoComplete="username" required name="identifier" type="text" placeholder="you@company.com or ada-kim" />
                </label>
              )}
              {isRegister && <label>
                <span>Email</span>
                <input required name="email" type="email" placeholder="you@company.com" />
              </label>}
              <label>
                <span className="label-row">
                  Password
                  {!isRegister && <a href="#forgot">Forgot password?</a>}
                </span>
                <input onChange={(event) => setRegistrationPassword(event.target.value)} required minLength={isRegister ? 12 : undefined} name="password" type="password" placeholder={isRegister ? "12+ characters" : "Password"} />
              </label>
              {isRegister && <PasswordStrengthIndicator password={registrationPassword} />}
              {isRegister && (
                <label className="terms-row">
                  <input required type="checkbox" />
                  <span>
                    I agree to the <a href="#terms">Terms of Service</a> and <a href="#privacy">Privacy Policy</a>.
                  </span>
                </label>
              )}
              <button className="dark-button auth-submit" disabled={submitting} type="submit">
                {submitting ? props.submittingLabel : props.submitLabel}
              </button>
              {error && (
                <div className="auth-error" role="alert">
                  <strong>{error}</strong>
                  <span>Check your details and try again.</span>
                </div>
              )}
            </form>
            <p className="auth-footer">
              {props.footerText} <Link href={footerHref}>{props.footerLabel}</Link>
            </p>
            <div className="secure-note">{isRegister ? "Private workspace, realtime editing, execution sandbox." : "Sessions are encrypted and scoped to your workspace."}</div>
          </div>
          <aside className="auth-journal" aria-label={isRegister ? "Slate workspace model" : "Slate workspace context"}>
            <div className="auth-journal-copy">
              <span>{isRegister ? "A workspace with context intact" : "Return to shared context"}</span>
              <h2>{isRegister ? "Files, decisions, and execution begin in the same room." : "Continue where the code, canvas, and team left off."}</h2>
            </div>
            <div className="auth-room-diagram" aria-label="Slate workspace connects code, canvas, runs, and activity" role="img">
              <div className="auth-room-wash" />
              <svg aria-hidden="true" viewBox="0 0 600 420" preserveAspectRatio="none">
                <path d="M130 88 C224 88 216 204 278 204" />
                <path d="M130 332 C224 332 216 216 278 216" />
                <path d="M322 204 C384 204 376 88 470 88" />
                <path d="M322 216 C384 216 376 332 470 332" />
              </svg>
              <span className="auth-room-node auth-room-node-code">Code</span>
              <span className="auth-room-node auth-room-node-canvas">Canvas</span>
              <span className="auth-room-node auth-room-node-runs">Runs</span>
              <span className="auth-room-node auth-room-node-activity">Activity</span>
              <div className="auth-room-hub">
                <small>Slate</small>
                <strong>Room</strong>
                <span>Live context</span>
              </div>
            </div>
            <div className="auth-journal-index">
              <span>01 / Realtime</span>
              <span>02 / Recoverable</span>
              <span>03 / Role scoped</span>
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}

function PasswordStrengthIndicator({ password }: { password: string }) {
  const score = [password.length >= 12, /[a-z]/.test(password), /[A-Z]/.test(password), /\d/.test(password), /[^A-Za-z0-9]/.test(password)].filter(Boolean).length;
  return <div className={`password-strength password-strength-${score}`} aria-live="polite"><div>{[0, 1, 2, 3].map((segment) => <span className={segment < Math.min(score, 4) ? "active" : ""} key={segment} />)}</div><small>{score === 5 ? "Strong password" : "Use 12+ characters with uppercase, lowercase, number, and symbol."}</small></div>;
}

async function readAuthError(response: Response) {
  const text = await response.text().catch(() => "");
  if (!text) return "Authentication failed";

  try {
    const body = JSON.parse(text) as { error?: unknown };
    if (typeof body.error !== "string") return "Authentication failed";
    if (body.error === "provider_rejected_request") return "Authentication service unavailable";
    return body.error;
  } catch {
    return response.status >= 500 ? "Authentication service unavailable" : "Authentication failed";
  }
}
