import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/BrandMark";
import { LandingWorkspaceGraph } from "@/components/LandingWorkspaceGraph";
import { authService } from "@/lib/server/auth";

const navItems = [
  ["Workflow", "#workflow"],
  ["Canvas", "#canvas"],
  ["Runs", "#runs"],
  ["Security", "#security"]
];

const capabilityItems = [
  ["01", "Realtime room", "Code, canvas, notes, and presence stay attached to one workspace."],
  ["02", "Native canvas", "Architecture sketches live beside the files and decisions they explain."],
  ["03", "Shared runs", "Command output becomes durable team context instead of terminal scrollback."]
];

const workflowSteps = [
  ["01", "Map the change", "Sketch boundaries, risks, and owners before the first code pass."],
  ["02", "Build in the room", "Edit files while canvas notes and collaborator presence stay visible."],
  ["03", "Run with memory", "Queue sandboxed checks and keep every result attached to the work."]
];

const securityItems = [
  ["Workspace roles", "Owner, editor, and viewer access stays scoped to the room."],
  ["Bounded execution", "Runs are isolated from the product shell and recorded as shared context."],
  ["Recoverable state", "Snapshots preserve important document states before work moves forward."],
  ["Activity trail", "Teams can follow what changed, who changed it, and where it happened."]
];

export default async function LandingPage() {
  const user = await authService.getCurrentUser();
  if (user) redirect("/workspace");

  return (
    <main className="site-shell slate-landing" id="top">
      <header className="landing-header">
        <div className="landing-header-inner">
          <BrandMark href="/" />
          <nav className="landing-nav" aria-label="Primary navigation">
            {navItems.map(([label, href]) => (
              <a key={href} href={href}>
                {label}
              </a>
            ))}
          </nav>
          <div className="header-actions">
            <Link className="landing-text-link" href="/login">
              Sign in
            </Link>
            <Link className="landing-blue-button landing-header-button" href="/register">
              Start <span aria-hidden="true">↗</span>
            </Link>
          </div>
        </div>
      </header>

      <section className="hero-section" aria-labelledby="landing-title">
        <div className="hero-copy">
          <p className="landing-kicker">A realtime workspace for shipping software together</p>
          <h1 id="landing-title">Keep the work and its reasoning in one room.</h1>
          <p className="hero-description">
            Slate keeps implementation, architecture notes, sandboxed runs, and collaborator presence together, so software work does not fracture across five tools.
          </p>
          <div className="hero-actions">
            <Link className="landing-black-button" href="/register">
              Create workspace
            </Link>
            <Link className="landing-ghost-button" href="/workspace">
              View workspace
            </Link>
          </div>
        </div>
        <LandingWorkspaceGraph />
      </section>

      <section className="capability-index" aria-label="Core Slate capabilities">
        {capabilityItems.map(([number, title, body]) => (
          <article className="capability-index-item" key={title}>
            <span>{number}</span>
            <h2>{title}</h2>
            <p>{body}</p>
          </article>
        ))}
      </section>

      <section className="workflow-section" id="workflow">
        <div className="section-heading workflow-heading">
          <p className="section-eyebrow">Workflow</p>
          <h2>The difficult middle of software work should stay visible.</h2>
          <p>
            Most tools collect updates after the work is done. Slate keeps decisions, implementation, and evidence connected while the work is still changing.
          </p>
        </div>
        <div className="workflow-list">
          {workflowSteps.map(([number, title, body]) => (
            <article className="workflow-step" key={number}>
              <span className="workflow-number">{number}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="product-section" aria-label="Slate product surfaces">
        <article className="canvas-feature-card" id="canvas">
          <div className="product-copy">
            <p className="section-eyebrow">Architecture canvas</p>
            <h2>Plans stay close to the code they affect.</h2>
            <p>
              Turn system diagrams, decisions, and implementation notes into first-class workspace surfaces instead of screenshots lost in chat.
            </p>
            <a className="landing-arrow-link" href="#workflow">
              See the workflow <span aria-hidden="true">→</span>
            </a>
          </div>
          <div className="canvas-illustration" aria-label="Architecture canvas showing connected service nodes" role="img">
            <div className="canvas-wash" />
            <svg aria-hidden="true" viewBox="0 0 620 360">
              <path d="M154 92 C250 92 230 176 324 176" />
              <path d="M150 266 C244 266 238 194 324 194" />
              <path d="M408 184 C474 184 486 108 548 108" />
              <path d="M408 184 C476 184 486 260 548 260" />
            </svg>
            <span className="canvas-pill canvas-pill-api">API layer</span>
            <span className="canvas-pill canvas-pill-sync">Realtime sync</span>
            <span className="canvas-pill canvas-pill-room">Workspace room</span>
            <span className="canvas-pill canvas-pill-notes">Decisions</span>
            <span className="canvas-pill canvas-pill-history">Snapshots</span>
          </div>
        </article>

        <article className="runs-feature-card" id="runs">
          <div className="runs-terminal" aria-label="Example shared Slate run">
            <div className="terminal-heading">
              <span />
              <small>billing-platform / run 184</small>
              <strong>Passed</strong>
            </div>
            <pre>
              <span>$ slate run ci --sandbox</span>
              <span>queued     lint</span>
              <span>running    unit tests</span>
              <strong>passed     deploy gate in 41s</strong>
              <span>attached   workspace activity</span>
            </pre>
          </div>
          <div className="product-copy">
            <p className="section-eyebrow">Execution context</p>
            <h2>A run is not done until the room can see it.</h2>
            <p>
              Queued commands, output, pass states, and activity events remain visible to collaborators, giving every debugging session a durable trail.
            </p>
            <ul>
              <li>Sandboxed command runs</li>
              <li>Shared output stream</li>
              <li>Recoverable snapshots</li>
            </ul>
          </div>
        </article>
      </section>

      <section className="security-section" id="security">
        <div className="section-heading security-heading">
          <p className="section-eyebrow">Product depth</p>
          <h2>Collaboration needs more than visible cursors.</h2>
          <p>
            Slate earns trust through permissions, recoverable state, bounded execution, and a clear activity history.
          </p>
        </div>
        <div className="security-grid">
          {securityItems.map(([title, body], index) => (
            <article className="security-item" key={title}>
              <span>0{index + 1}</span>
              <h3>{title}</h3>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="cta-section">
        <p className="section-eyebrow">Start together</p>
        <h2>Give the next change one room to live in.</h2>
        <p>Bring code, diagrams, notes, and run output into the same software workspace.</p>
        <div className="cta-actions">
          <Link className="landing-black-button" href="/register">
            Create workspace
          </Link>
          <Link className="landing-ghost-button" href="/login">
            Sign in
          </Link>
        </div>
      </section>

      <footer className="site-footer">
        <BrandMark href="/" compact />
        <p>Software work, with its context intact.</p>
        <nav aria-label="Footer navigation">
          <a href="#workflow">Workflow</a>
          <a href="#canvas">Canvas</a>
          <a href="#security">Security</a>
          <a href="#top">Back to top ↑</a>
        </nav>
      </footer>
    </main>
  );
}
