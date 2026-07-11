CREATE TABLE "WorkspaceSettings" (
    "id" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "defaultInviteRole" "WorkspaceRole" NOT NULL DEFAULT 'viewer',
    "allowEditorInvites" BOOLEAN NOT NULL DEFAULT false,
    "allowViewerComments" BOOLEAN NOT NULL DEFAULT true,
    "allowEditorFileDelete" BOOLEAN NOT NULL DEFAULT true,
    "showCollaboratorPresence" BOOLEAN NOT NULL DEFAULT true,
    "showDocumentActivity" BOOLEAN NOT NULL DEFAULT true,
    "fileTreeSortMode" TEXT NOT NULL DEFAULT 'manual',
    "autoSaveEnabled" BOOLEAN NOT NULL DEFAULT true,
    "retentionDays" INTEGER NOT NULL DEFAULT 90,
    "exportIncludesActivity" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "workspaceId" TEXT NOT NULL,

    CONSTRAINT "WorkspaceSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceSettings_workspaceId_key" ON "WorkspaceSettings"("workspaceId");

ALTER TABLE "WorkspaceSettings" ADD CONSTRAINT "WorkspaceSettings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "WorkspaceSettings" (
    "id",
    "updatedAt",
    "workspaceId"
)
SELECT
    'wsset_' || "id",
    CURRENT_TIMESTAMP,
    "id"
FROM "Workspace"
ON CONFLICT ("workspaceId") DO NOTHING;
