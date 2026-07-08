import { CursorIcon } from "@/components/Icons";

type ProductPreviewProps = {
  compact?: boolean;
};

const fileNames = ["charge.ts", "retry.ts", "webhook.ts", "types.ts"];

const codeLines = [
  ["async function ", "charge", "(req: Charge) {"],
  ["  const key = ", "dedupe", "(req.orderId)"],
  ["  const prior = await store.", "find", "(key)"],
  ["  if (prior) return prior", "", ""],
  ["  return gateway.", "submit", "({"],
  ["    amount: req.amount,", "", ""],
  ["    currency: req.currency,", "", ""],
  ["    key,", "", ""],
  ["  })", "", ""],
  ["}", "", ""]
];

export function ProductPreview({ compact = false }: ProductPreviewProps) {
  return (
    <div className={compact ? "product-preview product-preview-compact" : "product-preview"}>
      <div className="preview-topbar">
        <div>
          <span className="mini-brand" />
          <strong>payments-service</strong>
          <span className="sync-pill">
            <span />
            Synced
          </span>
        </div>
        <div>
          <span className="avatar avatar-blue">AK</span>
          <span className="avatar avatar-violet">MR</span>
          <span className="avatar avatar-teal">JT</span>
          <span className="run-pill">Run</span>
        </div>
      </div>
      <div className="preview-grid">
        <aside className="preview-files">
          <p>Files</p>
          {fileNames.map((file) => (
            <span className={file === "charge.ts" ? "active-file" : ""} key={file}>
              {file}
            </span>
          ))}
        </aside>
        <div className="preview-code">
          {codeLines.slice(0, compact ? 7 : 10).map((line, index) => (
            <pre key={`${line[0]}-${index}`}>
              <span>{line[0]}</span>
              <b>{line[1]}</b>
              <span>{line[2]}</span>
              {index === 3 && !compact && <i>Mira</i>}
            </pre>
          ))}
        </div>
        <div className="preview-right">
          <div className="preview-canvas">
            <div className="diagram-card diagram-card-one">
              <strong>charge()</strong>
              <span>idempotent entry</span>
            </div>
            <div className="diagram-card diagram-card-two">
              <strong>gateway.submit</strong>
              <span>external boundary</span>
            </div>
            <svg className="diagram-link" viewBox="0 0 300 220">
              <path d="M86 68 C86 104 150 88 150 124" />
            </svg>
            <div className="remote-cursor">
              <CursorIcon />
              <span>Jonah</span>
            </div>
          </div>
          {!compact && (
            <div className="preview-output">
              <p><span>$</span> slate run charge.test.ts</p>
              <p><b>✓</b> returns existing charge on replay <span>12ms</span></p>
              <p><b>✓</b> submits with idempotency key <span>31ms</span></p>
              <p>sandbox exited · code 0 · 118ms</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
