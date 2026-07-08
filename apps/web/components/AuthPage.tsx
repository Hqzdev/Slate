"use client";

import Link from "next/link";
import { FormEvent, useState, useSyncExternalStore } from "react";
import { BrandMark } from "@/components/BrandMark";

type AuthPageProps = {
  mode: "login" | "register";
  title: string;
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
        password: formData.get("password")
      }),
      headers: { "content-type": "application/json" },
      method: "POST"
    });

    if (response.ok) {
      window.location.href = invite ? `/invite/${encodeURIComponent(invite)}` : next ?? "/workspace";
      return;
    }

    const message = await readAuthError(response);
    setError(message);
    setSubmitting(false);
  }

  return (
    <main className="auth-shell">
      <header className="auth-header">
        <BrandMark href="/" />
      </header>
      <section className="auth-main">
        <div className="auth-panel">
          <h1>{props.title}</h1>
          <p>{props.subtitle}</p>
          <form className="auth-form" onSubmit={handleSubmit}>
            {props.mode === "register" && (
              <label>
                <span>Name</span>
                <input required name="name" type="text" placeholder="Ada Kim" />
              </label>
            )}
            <label>
              <span>Email</span>
              <input required name="email" type="email" placeholder="you@company.com" />
            </label>
            <label>
              <span className="label-row">
                Password
                {props.mode === "login" && <a href="#forgot">Forgot password?</a>}
              </span>
              <input required minLength={props.mode === "register" ? 8 : undefined} name="password" type="password" placeholder={props.mode === "register" ? "8+ characters" : "••••••••"} />
            </label>
            {props.mode === "register" && (
              <label className="terms-row">
                <input required type="checkbox" />
                <span>
                  I agree to the <a href="#terms">Terms of Service</a> and <a href="#privacy">Privacy Policy</a>.
                </span>
              </label>
            )}
            <button className="dark-button" disabled={submitting} type="submit">
              {submitting ? props.submittingLabel : props.submitLabel}
            </button>
            {error && <strong className="auth-error">{error}</strong>}
          </form>
          <p className="auth-footer">
            {props.footerText} <Link href={footerHref}>{props.footerLabel}</Link>
          </p>
          {props.mode === "login" && (
            <div className="secure-note">Sessions are encrypted and scoped to your workspace.</div>
          )}
        </div>
      </section>
    </main>
  );
}

async function readAuthError(response: Response) {
  const text = await response.text().catch(() => "");
  if (!text) return "Authentication failed";

  try {
    const body = JSON.parse(text) as { error?: unknown };
    return typeof body.error === "string" ? body.error : "Authentication failed";
  } catch {
    return response.status >= 500 ? "Authentication service unavailable" : "Authentication failed";
  }
}
