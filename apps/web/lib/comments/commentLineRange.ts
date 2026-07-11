export type CommentLineRange = {
  end: number;
  start: number;
};

const maximumDatabaseInteger = 2_147_483_647;

export function normalizeCommentLineRange(lineStart: unknown, lineEnd: unknown): CommentLineRange | null {
  const startMissing = lineStart === null || lineStart === undefined;
  const endMissing = lineEnd === null || lineEnd === undefined;

  if (startMissing && endMissing) return null;
  if (startMissing || endMissing) throw new Error("Comment line range is incomplete");
  if (!Number.isInteger(lineStart) || !Number.isInteger(lineEnd)) throw new Error("Comment line range must use whole numbers");

  const start = lineStart as number;
  const end = lineEnd as number;

  if (start < 1 || end < 1) throw new Error("Comment line range must be positive");
  if (start > maximumDatabaseInteger || end > maximumDatabaseInteger) throw new Error("Comment line range is too large");
  if (end < start) throw new Error("Comment line range is invalid");

  return { end, start };
}
