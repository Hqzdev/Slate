"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/BrandMark";

type InvitePayload = {
  acceptedAt: string | null;
  createdByName: string;
  email: string | null;
  expiresAt: string;
  role: "editor" | "owner" | "viewer";
  workspace: {
    id: string;
    name: string;
    slug: string;
  };
};

export function InvitePage({ token }: { token: string }) {
  const [invite, setInvite] = useState<InvitePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadInvite() {
      const response = await fetch(`/api/invites/${token}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({ error: "Invite failed to load" }));

      if (response.ok) {
        setInvite(body.invite);
      } else {
        setError(typeof body.error === "string" ? body.error : "Invite failed to load");
      }

      setLoading(false);
    }

    void loadInvite();
  }, [token]);

  async function acceptInvite() {
    setAccepting(true);
    setError(null);

    const response = await fetch(`/api/invites/${token}/accept`, { method: "POST" });

    if (response.status === 401) {
      window.location.href = `/login?invite=${encodeURIComponent(token)}`;
      return;
    }

    const body = await response.json().catch(() => ({ error: "Invite accept failed" }));

    if (response.ok) {
      window.location.href = `/workspace?workspaceId=${body.invite.workspace.id}`;
      return;
    }

    setError(typeof body.error === "string" ? body.error : "Invite accept failed");
    setAccepting(false);
  }

  return (
    <main className="auth-shell invite-shell">
      <header className="auth-header">
        <BrandMark href="/" />
      </header>
      <section className="auth-main">
        <div className="auth-panel invite-panel">
          <span className="invite-kicker">Workspace invite</span>
          {loading ? (
            <>
              <h1>Loading invite</h1>
              <p>Checking the link before joining the workspace.</p>
            </>
          ) : invite ? (
            <>
              <h1>Join {invite.workspace.name}</h1>
              <p>{invite.createdByName} invited you as {invite.role}{invite.email ? ` for ${invite.email}` : ""}.</p>
              <div className="invite-details">
                <span>Workspace</span>
                <strong>{invite.workspace.slug}</strong>
                <span>Expires</span>
                <strong>{new Date(invite.expiresAt).toLocaleDateString()}</strong>
              </div>
              {invite.acceptedAt ? (
                <Link className="dark-button" href="/workspace">Open workspace</Link>
              ) : (
                <button className="dark-button" disabled={accepting} onClick={acceptInvite}>
                  {accepting ? "Joining..." : "Accept invite"}
                </button>
              )}
            </>
          ) : (
            <>
              <h1>Invite unavailable</h1>
              <p>{error ?? "This invite link is invalid or expired."}</p>
              <Link className="light-button" href="/login">Sign in</Link>
            </>
          )}
          {error && invite && <strong className="auth-error">{error}</strong>}
        </div>
      </section>
    </main>
  );
}
