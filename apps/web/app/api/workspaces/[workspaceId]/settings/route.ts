import { NextRequest, NextResponse } from "next/server";
import { type WorkspaceRole } from "@prisma/client";
import { guardMutationRequest } from "@/lib/server/apiSecurity";
import { authService } from "@/lib/server/auth";
import { workspaceRepository, type WorkspaceSettingsPayload } from "@/lib/server/workspaceRepository";

export const runtime = "nodejs";

const roles = new Set<WorkspaceRole>(["editor", "viewer"]);
const fileTreeSortModes = new Set(["manual", "name", "changes"]);

function parseBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function parseString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  return value.trim().slice(0, maxLength);
}

function parseRetentionDays(value: unknown) {
  if (typeof value !== "number" || !Number.isInteger(value)) return undefined;
  return Math.min(Math.max(value, 7), 365);
}

function parseSettingsPatch(body: Record<string, unknown>) {
  const patch: Partial<WorkspaceSettingsPayload> = {};
  const description = parseString(body.description, 240);
  const retentionDays = parseRetentionDays(body.retentionDays);
  const defaultInviteRole = body.defaultInviteRole;
  const fileTreeSortMode = body.fileTreeSortMode;

  if (description !== undefined) patch.description = description;
  if (roles.has(defaultInviteRole as WorkspaceRole)) patch.defaultInviteRole = defaultInviteRole as WorkspaceRole;
  if (fileTreeSortModes.has(String(fileTreeSortMode))) patch.fileTreeSortMode = String(fileTreeSortMode);
  if (retentionDays !== undefined) patch.retentionDays = retentionDays;

  for (const key of ["allowEditorInvites", "allowViewerComments", "allowEditorFileDelete", "showCollaboratorPresence", "showDocumentActivity", "autoSaveEnabled", "exportIncludesActivity"] as const) {
    const value = parseBoolean(body[key]);
    if (value !== undefined) patch[key] = value;
  }

  return patch;
}

function settingsError(error: unknown, fallback: string) {
  if (!(error instanceof Error) || !error.message) return fallback;
  if (error.message === "Workspace access denied") return error.message;
  if (error.message.includes("Can't reach database server")) return "Database is unavailable. Start Postgres and try again.";
  return fallback;
}

export async function GET(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  const user = await authService.getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { workspaceId } = await context.params;

  try {
    const settings = await workspaceRepository.getWorkspaceSettings(user.id, workspaceId);
    return NextResponse.json({ settings });
  } catch (error) {
    return NextResponse.json({ error: settingsError(error, "Workspace settings failed to load") }, { status: 403 });
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ workspaceId: string }> }) {
  const denied = await guardMutationRequest(request, { scope: "workspace-settings:update" });
  if (denied) return denied;

  const user = await authService.getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const patch = parseSettingsPatch(body);

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "No valid workspace settings were provided" }, { status: 400 });
  }

  const { workspaceId } = await context.params;

  try {
    const settings = await workspaceRepository.updateWorkspaceSettings(user.id, workspaceId, patch);
    return NextResponse.json({ settings });
  } catch (error) {
    return NextResponse.json({ error: settingsError(error, "Workspace settings update failed") }, { status: 403 });
  }
}
