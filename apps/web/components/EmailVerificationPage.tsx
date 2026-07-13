"use client";

import { type ChangeEvent, type ClipboardEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BrandMark } from "@/components/BrandMark";

const codeLength = 6;

export function EmailVerificationPage() {
  const searchParams = useSearchParams();
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [digits, setDigits] = useState(() => Array.from({ length: codeLength }, () => ""));
  const [verificationError, setVerificationError] = useState("");
  const [resendError, setResendError] = useState("");
  const [remainingResends, setRemainingResends] = useState<number | null>(null);
  const [developmentCode, setDevelopmentCode] = useState<string | null>(null);
  const email = searchParams.get("email") ?? "";
  const error = searchParams.get("error");
  const code = digits.join("");

  useEffect(() => {
    const localCode = window.sessionStorage.getItem("slate-development-verification-code");
    const frame = window.requestAnimationFrame(() => setDevelopmentCode(localCode));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  function updateCode(value: string, index: number) {
    const nextDigits = value.replace(/\D/g, "").slice(0, codeLength).split("");
    if (nextDigits.length > 1) {
      setDigits(Array.from({ length: codeLength }, (_, digitIndex) => nextDigits[digitIndex] ?? ""));
      inputRefs.current[Math.min(nextDigits.length, codeLength) - 1]?.focus();
      return;
    }
    const nextCode = [...digits];
    nextCode[index] = nextDigits[0] ?? "";
    setDigits(nextCode);
    if (nextDigits[0] && index < codeLength - 1) inputRefs.current[index + 1]?.focus();
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();
    const pastedCode = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, codeLength);
    if (!pastedCode) return;
    setDigits(Array.from({ length: codeLength }, (_, index) => pastedCode[index] ?? ""));
    inputRefs.current[Math.min(pastedCode.length, codeLength) - 1]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>, index: number) {
    if (event.key === "Backspace" && !digits[index] && index > 0) inputRefs.current[index - 1]?.focus();
  }

  async function resend() {
    setPending(true);
    setResendError("");
    const response = await fetch("/api/auth/resend-verification", { body: JSON.stringify({ email }), headers: { "content-type": "application/json" }, method: "POST" });
    setSent(response.ok);
    const body = await response.json().catch(() => ({})) as { developmentCode?: string | null; error?: string; remaining?: number };
    if (response.ok) {
      setRemainingResends(typeof body.remaining === "number" ? body.remaining : null);
      setDevelopmentCode(body.developmentCode ?? null);
    }
    else setResendError(body.error ?? "Slate could not deliver a code. Check the email provider configuration and try again.");
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

  return (
    <main className="onboarding-shell">
      <header className="onboarding-header"><BrandMark href="/" /></header>
      <section className="onboarding-card verification-card">
        <p className="onboarding-eyebrow">Secure your account</p>
        <h1>Verify your email to enter Slate.</h1>
        <p>{error ? "Your previous code expired." : `We sent a six-digit code to ${email || "your email address"}.`}</p>
        <div className="verification-code" aria-label="Verification code">
          <span>Verification code</span>
          <div className="verification-code-inputs">
            {digits.map((digit, index) => <input aria-label={`Digit ${index + 1}`} autoComplete={index === 0 ? "one-time-code" : "off"} inputMode="numeric" key={index} maxLength={codeLength} onChange={(event: ChangeEvent<HTMLInputElement>) => updateCode(event.target.value, index)} onKeyDown={(event) => handleKeyDown(event, index)} onPaste={handlePaste} ref={(element) => { inputRefs.current[index] = element; }} value={digit} />)}
          </div>
        </div>
        {verificationError && <strong className="auth-error">{verificationError}</strong>}
        <button className="onboarding-submit" disabled={pending || code.length !== codeLength} onClick={() => void verify()} type="button">{pending ? "Checking…" : "Verify email"}</button>
        <button className="onboarding-secondary" disabled={pending || !email || remainingResends === 0} onClick={() => void resend()} type="button">{sent ? "Code sent" : "Send a new code"}</button>
        {remainingResends !== null && <small className="resend-limit-status">{remainingResends} of 3 resend attempts remaining in 12 hours.</small>}
        {developmentCode && <div className="development-code"><span>Verification code</span><strong>{developmentCode}</strong></div>}
        {resendError && <strong className="auth-error">{resendError}</strong>}
      </section>
    </main>
  );
}
