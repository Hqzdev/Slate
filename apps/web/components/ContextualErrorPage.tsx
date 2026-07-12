import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";

export type ErrorPageVariant = "document" | "forbidden" | "public" | "unavailable" | "workspace";

type ErrorPageContent = {
  description: string;
  eyebrow?: string;
  primaryHref: string;
  primaryLabel: string;
  secondaryHref: string;
  secondaryLabel: string;
  title: string;
};

const errorPageContent: Record<ErrorPageVariant, ErrorPageContent> = {
  public: {
    description: "The link may be outdated or the page may have moved.",
    primaryHref: "/",
    primaryLabel: "Back to home",
    secondaryHref: "/login",
    secondaryLabel: "Sign in",
    title: "This page doesn’t exist."
  },
  unavailable: {
    description: "We couldn’t load this workspace right now.",
    eyebrow: "Workspace",
    primaryHref: "/dashboard",
    primaryLabel: "Back to dashboard",
    secondaryHref: "/",
    secondaryLabel: "Go to home",
    title: "Workspace unavailable."
  },
  workspace: {
    description: "It may have been deleted, moved, or you may not have access.",
    eyebrow: "Workspace",
    primaryHref: "/dashboard",
    primaryLabel: "Back to dashboard",
    secondaryHref: "/",
    secondaryLabel: "Go to home",
    title: "This workspace isn’t available."
  },
  document: {
    description: "The file may have been deleted or moved.",
    eyebrow: "Document",
    primaryHref: "/workspace",
    primaryLabel: "Back to workspace",
    secondaryHref: "/dashboard",
    secondaryLabel: "Open dashboard",
    title: "This document wasn’t found."
  },
  forbidden: {
    description: "This area is restricted to workspace members with access.",
    eyebrow: "Access",
    primaryHref: "mailto:support@slate.dev?subject=Workspace%20access%20request",
    primaryLabel: "Request access",
    secondaryHref: "/dashboard",
    secondaryLabel: "Back to workspace",
    title: "You don’t have access."
  }
};

type ContextualErrorPageProps = {
  variant?: ErrorPageVariant;
};

export function ContextualErrorPage({ variant = "public" }: ContextualErrorPageProps) {
  const content = errorPageContent[variant];

  return (
    <main className="slate-error-page">
      <header className="slate-error-header">
        <BrandMark href="/" />
      </header>
      <section aria-labelledby="error-page-title" className="slate-error-content">
        {content.eyebrow ? <p className="slate-error-eyebrow">{content.eyebrow}</p> : <p className="slate-error-code">404</p>}
        <h1 id="error-page-title">{content.title}</h1>
        <p className="slate-error-description">{content.description}</p>
        <div className="slate-error-actions">
          <Link className="slate-error-primary" href={content.primaryHref}>{content.primaryLabel}</Link>
          <Link className="slate-error-secondary" href={content.secondaryHref}>{content.secondaryLabel}</Link>
        </div>
      </section>
    </main>
  );
}
