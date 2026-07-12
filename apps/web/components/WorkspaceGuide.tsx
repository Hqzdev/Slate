"use client";

import { useEffect, useState } from "react";

const steps = [
  { selector: "[data-guide-target='navigation']", text: "This is your workspace navigation. Move between the overview, files, activity, and tools from here.", title: "Your room" },
  { selector: "[data-guide-target='controls']", text: "Workspace controls and notifications stay in one compact header.", title: "Stay in control" },
  { selector: "[data-guide-target='content']", text: "This is where files, notes, canvas, and shared work open without losing their context.", title: "The work surface" }
];

export function WorkspaceGuide() {
  const [stepIndex, setStepIndex] = useState(0);
  const [visible, setVisible] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("guide") === "1");
  const [rect, setRect] = useState<DOMRect | null>(null);
  const step = steps[stepIndex];
  useEffect(() => {
    if (!visible) return;
    const updateRect = () => setRect(document.querySelector(step.selector)?.getBoundingClientRect() ?? null);
    updateRect();
    window.addEventListener("resize", updateRect);
    return () => window.removeEventListener("resize", updateRect);
  }, [step.selector, visible]);
  async function finish() {
    await fetch("/api/onboarding/guide", { method: "POST" });
    const url = new URL(window.location.href);
    url.searchParams.delete("guide");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    setVisible(false);
  }
  if (!visible) return null;
  return <div className="workspace-guide" role="dialog" aria-modal="true" aria-label="Slate workspace guide">{rect && <div className="workspace-guide-highlight" style={{ height: rect.height, left: rect.left, top: rect.top, width: rect.width }} />}<section className="workspace-guide-card"><span>{stepIndex + 1} / {steps.length}</span><h2>{step.title}</h2><p>{step.text}</p><div><button onClick={() => void finish()} type="button">Skip</button><button className="primary" onClick={() => stepIndex === steps.length - 1 ? void finish() : setStepIndex((current) => current + 1)} type="button">{stepIndex === steps.length - 1 ? "Finish" : "Next"}</button></div></section></div>;
}
