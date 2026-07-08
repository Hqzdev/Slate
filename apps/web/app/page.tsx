import Link from "next/link";
import { BrandMark } from "@/components/BrandMark";
import { ProductPreview } from "@/components/ProductPreview";
import { ArrowIcon } from "@/components/Icons";

const navItems = [
  ["Collaboration", "#collaboration"],
  ["Execution", "#execution"],
  ["Canvas", "#canvas"],
  ["Security", "#security"]
];

const featureRows = [
  {
    id: "collaboration",
    eyebrow: "Realtime collaboration",
    title: "Everyone edits the same buffer. Nobody waits.",
    body: "Every keystroke replicates through a shared document, so edits merge without locks or conflicts. Cursors, selections, and canvas positions are visible to the whole room.",
    items: ["Named cursors and live selections", "Room state that survives reloads", "Follow mode for teammate context"]
  },
  {
    id: "execution",
    eyebrow: "Sandboxed execution",
    title: "Run it in the room, not on your laptop.",
    body: "Code execution belongs behind a strict boundary. The first product loop streams output back to everyone without exposing application secrets or local machines.",
    items: ["Language allowlist", "Memory, CPU, and timeout limits", "Shared run history per room"]
  },
  {
    id: "canvas",
    eyebrow: "Infinite canvas",
    title: "The whiteboard sits next to the code.",
    body: "Sketch the architecture in the same room where the implementation lives. Notes, arrows, and decisions stay beside the files they describe.",
    items: ["Architecture sketches", "Sticky notes", "Shared pointers"]
  }
];

export default function LandingPage() {
  return (
    <main className="site-shell">
      <header className="landing-header">
        <div className="landing-header-inner">
          <BrandMark href="/" />
          <nav className="landing-nav" aria-label="Primary">
            {navItems.map(([label, href]) => (
              <a key={href} href={href}>
                {label}
              </a>
            ))}
          </nav>
          <div className="header-actions">
            <Link className="ghost-link" href="/login">
              Sign in
            </Link>
            <Link className="dark-button small-button" href="/register">
              Get started
            </Link>
          </div>
        </div>
      </header>

      <section className="hero-section">
        <div className="hero-copy">
          <div className="beta-pill">
            <span />
            Realtime multiplayer, now in public beta
          </div>
          <h1>Code, sketch, and run together.</h1>
          <p>
            Slate is a realtime workspace for shipping software together. Live code, shared canvas,
            sandboxed execution, one room, full context.
          </p>
          <div className="hero-actions">
            <Link className="dark-button" href="/register">
              Start building
            </Link>
            <Link className="light-button" href="/workspace">
              Open a live demo
            </Link>
          </div>
          <div className="hero-metrics">
            <span>~40ms sync latency</span>
            <span>CRDT-backed</span>
            <span>Sandbox-first</span>
          </div>
        </div>
      </section>

      <section className="preview-section" aria-label="Product preview">
        <ProductPreview />
      </section>

      {featureRows.map((feature, index) => (
        <section className="feature-section" id={feature.id} key={feature.id}>
          <div className={`feature-grid ${index % 2 === 1 ? "feature-grid-reversed" : ""}`}>
            <div>
              <p className="section-eyebrow">{feature.eyebrow}</p>
              <h2>{feature.title}</h2>
              <p>{feature.body}</p>
              <ul>
                {feature.items.map((item) => (
                  <li key={item}>
                    <ArrowIcon />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="feature-visual">
              <ProductPreview compact />
            </div>
          </div>
        </section>
      ))}

      <section className="security-section" id="security">
        <div className="section-heading">
          <p className="section-eyebrow">Security model</p>
          <h2>Isolation is the architecture, not a feature.</h2>
          <p>
            Untrusted code never touches the sync layer. Every run is brokered, constrained, and
            logged as part of the room history.
          </p>
        </div>
        <div className="security-flow">
          {["Clients", "Sync layer", "Execution broker", "Sandbox"].map((item) => (
            <div className="security-node" key={item}>
              <strong>{item}</strong>
              <span>{item === "Sandbox" ? "no net · no secrets · timeout" : "room-scoped boundary"}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="cta-section">
        <h2>Built for teams that need context and execution in one room.</h2>
        <p>Free for up to 3 collaborators per room. No credit card.</p>
        <div>
          <Link className="dark-button" href="/register">
            Create a workspace
          </Link>
          <Link className="light-button" href="/login">
            Sign in
          </Link>
        </div>
      </section>

      <footer className="site-footer">
        <BrandMark href="/" compact />
        <div>
          <a href="#security">Security</a>
          <a href="#top">Status</a>
          <a href="#top">Privacy</a>
          <a href="#top">Terms</a>
        </div>
      </footer>
    </main>
  );
}
