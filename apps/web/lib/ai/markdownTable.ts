const markdownTableMaximumLength = 262_144;

function escapeMarkdownTableCell(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r\n|\r|\n/g, "<br>");
}

function renderRow(values: string[]) {
  return `| ${values.map(escapeMarkdownTableCell).join(" | ")} |`;
}

export function renderMarkdownTable(columns: string[], rows: string[][]) {
  const content = [
    renderRow(columns),
    renderRow(columns.map(() => "---")),
    ...rows.map(renderRow)
  ].join("\n");

  if (content.length > markdownTableMaximumLength) {
    throw new Error("Table note exceeds the maximum content length");
  }

  return content;
}
