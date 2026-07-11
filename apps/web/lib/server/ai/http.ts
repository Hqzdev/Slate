import { NextResponse } from "next/server";
import { AiDomainError, toAiDomainError } from "./errors";

export function aiErrorResponse(error: unknown) {
  const domainError = toAiDomainError(error);
  return NextResponse.json({
    code: domainError.code,
    error: domainError.message,
    retryable: domainError.retryable
  }, { status: domainError.status });
}

export async function readJsonBody(request: Request) {
  try {
    return await request.json() as unknown;
  } catch {
    throw new AiDomainError("invalid_json", "Request body must be valid JSON", 400);
  }
}
