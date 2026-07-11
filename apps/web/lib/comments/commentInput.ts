export type CreateCommentInput = {
  body: string;
  fileNodeId: string | null;
  lineEnd: unknown;
  lineStart: unknown;
  shapeId: string | null;
};

export function parseCreateCommentInput(value: unknown): CreateCommentInput {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    body: typeof input.body === "string" ? input.body : "",
    fileNodeId: typeof input.fileNodeId === "string" ? input.fileNodeId : null,
    lineEnd: input.lineEnd,
    lineStart: input.lineStart,
    shapeId: typeof input.shapeId === "string" ? input.shapeId : null
  };
}
