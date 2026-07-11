CREATE UNIQUE INDEX "WorkspaceFileNode_active_sibling_name_key"
ON "WorkspaceFileNode" ("workspaceId", COALESCE("parentId", ''), "name")
WHERE "archivedAt" IS NULL;
