"use client";

import { FormEvent, useState } from "react";
import { BrandMark } from "@/components/BrandMark";

const questions = [
  { id: "discoverySource", label: "How did you find Slate?", options: [["search", "Search"], ["friend", "A friend or teammate"], ["social", "Social media"], ["community", "Community"], ["other", "Other"]] },
  { id: "intendedUse", label: "What will you use Slate for?", options: [["personal", "Personal projects"], ["team", "Team work"], ["study", "Study"], ["client", "Client work"], ["other", "Other"]] },
  { id: "role", label: "Which role fits you best?", options: [["developer", "Developer"], ["designer", "Designer"], ["founder", "Founder"], ["student", "Student"], ["manager", "Manager"], ["other", "Other"]] }
] as const;

export function OnboardingSurvey() {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const complete = questions.every((question) => answers[question.id]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!complete || pending) return;
    setPending(true);
    setError("");
    const response = await fetch("/api/onboarding", { body: JSON.stringify(answers), headers: { "content-type": "application/json" }, method: "POST" });
    if (response.ok) window.location.assign("/workspace?guide=1");
    else {
      setError("We could not save your answers. Try again.");
      setPending(false);
    }
  }
  return <main className="onboarding-shell"><header className="onboarding-header"><BrandMark href="/" /><span>Set up your room</span></header><form className="onboarding-card onboarding-survey" onSubmit={submit}><p className="onboarding-eyebrow">A minute, once</p><h1>Shape Slate around your work.</h1><p>Your answers are private to your account and help us make the first workspace relevant.</p>{questions.map((question) => <fieldset key={question.id}><legend>{question.label}</legend><div>{question.options.map(([value, label]) => <button className={answers[question.id] === value ? "selected" : ""} key={value} onClick={() => setAnswers((current) => ({ ...current, [question.id]: value }))} type="button">{label}</button>)}</div></fieldset>)}{error && <strong className="auth-error">{error}</strong>}<button className="onboarding-submit" disabled={!complete || pending} type="submit">{pending ? "Opening workspace…" : "Continue to Slate"}</button></form></main>;
}
