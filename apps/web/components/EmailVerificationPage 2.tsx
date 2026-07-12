"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { BrandMark } from "@/components/BrandMark";

export function EmailVerificationPage() {
  const searchParams = useSearchParams();
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [code, setCode] = useState("");
  const [verificationError, setVerificationError] = useState("");
  const email = searchParams.get("email") ?? "";
  const error = searchParams.get("error");
  async function resend() {
    setPending(true);
    const response = await fetch("/api/auth/resend-verification", { body: JSON.stringify({ email }), headers: { "content-type": "application/json" }, method: "POST" });
    setSent(response.ok);
    setPending(false);
  }
  async function verify() {
    setPending(true);
    setVerificationError("");
    const response = await fetch("/api/auth/verify-email", { body: JSON.stringify({ code }), headers: { "content-type": "application/json" }, method: "POST" });
    if (response.ok) {
      const body = await response.json() as { redirectTo: string };
      window.location.assign(body.redirectTo);
      return;
    }
    const body = await response.json().catch(() => ({ error: "Verification failed" })) as { error?: string };
    setVerificationError(body.error ?? "Verification failed");
    setPending(false);
  }
  return <main className="onboarding-shell"><header className="onboarding-header"><BrandMark href="/" /></header><section className="onboarding-card"><p className="onboarding-eyebrow">Secure your account</p><h1>Verify your email to enter Slate.</h1><p>{error ? "Your previous code expired." : `We sent a six-digit code to ${email || "your email address"}.`}</p><label className="verification-code"><span>Verification code</span><input autoComplete="one-time-code" inputMode="numeric" maxLength={6} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} placeholder="000000" value={code} /></label>{verificationError && <strong className="auth-error">{verificationError}</strong>}<button className="onboarding-submit" disabled={pending || code.length !== 6} onClick={() => void verify()} type="button">{pending ? "Checking…" : "Verify email"}</button><button className="onboarding-secondary" disabled={pending || !email} onClick={() => void resend()} type="button">{sent ? "Code sent" : "Send a new code"}</button></section></main>;
}
