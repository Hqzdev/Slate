"use client";

import { useState } from "react";
import { ContextualErrorPage, type ErrorPageVariant } from "@/components/ContextualErrorPage";

const variants: Array<{ label: string; value: ErrorPageVariant }> = [
  { label: "Public 404", value: "public" },
  { label: "Workspace", value: "workspace" },
  { label: "Document", value: "document" },
  { label: "403 Access", value: "forbidden" }
];

export default function ErrorPreviewPage() {
  const [variant, setVariant] = useState<ErrorPageVariant>("public");

  return (
    <main className="error-preview-page">
      <nav aria-label="Error state preview" className="error-preview-toolbar">
        {variants.map((item) => (
          <button className={variant === item.value ? "active" : ""} key={item.value} onClick={() => setVariant(item.value)} type="button">
            {item.label}
          </button>
        ))}
      </nav>
      <ContextualErrorPage variant={variant} />
    </main>
  );
}
