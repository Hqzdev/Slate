const inputNodes = [
  ["Code", "Files and changes", "graph-node-code"],
  ["Canvas", "Architecture", "graph-node-canvas"],
  ["Notes", "Decisions", "graph-node-notes"]
];

const outputNodes = [
  ["Runs", "Shared output", "graph-node-runs"],
  ["Snapshots", "Recoverable state", "graph-node-snapshots"],
  ["Activity", "Durable trail", "graph-node-activity"]
];

export function LandingWorkspaceGraph() {
  return (
    <div className="landing-workspace-graph" aria-label="Code, canvas, and notes flow into a shared Slate workspace, producing runs, snapshots, and activity" role="img">
      <div className="graph-wash graph-wash-coral" />
      <div className="graph-wash graph-wash-mint" />
      <svg className="graph-connections" aria-hidden="true" viewBox="0 0 1200 520" preserveAspectRatio="none">
        <path d="M190 112 C380 112 390 248 538 248" />
        <path d="M190 260 C360 260 400 260 538 260" />
        <path d="M190 408 C380 408 390 272 538 272" />
        <path d="M662 248 C810 248 820 112 1010 112" />
        <path d="M662 260 C800 260 840 260 1010 260" />
        <path d="M662 272 C810 272 820 408 1010 408" />
      </svg>
      <div className="graph-node-column graph-node-column-input">
        {inputNodes.map(([title, meta, className]) => (
          <div className={`graph-node ${className}`} key={title}>
            <i />
            <span>{title}</span>
            <small>{meta}</small>
          </div>
        ))}
      </div>
      <div className="graph-hub">
        <span>Slate</span>
        <strong>Workspace</strong>
        <small>Live room</small>
      </div>
      <div className="graph-node-column graph-node-column-output">
        {outputNodes.map(([title, meta, className]) => (
          <div className={`graph-node ${className}`} key={title}>
            <i />
            <span>{title}</span>
            <small>{meta}</small>
          </div>
        ))}
      </div>
    </div>
  );
}
