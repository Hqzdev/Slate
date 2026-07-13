CREATE TABLE "GitHubConnectionAttempt" (
    "id" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    CONSTRAINT "GitHubConnectionAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GitHubWorkspaceInstallation" (
    "id" TEXT NOT NULL,
    "githubInstallationId" BIGINT NOT NULL,
    "accountLogin" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    CONSTRAINT "GitHubWorkspaceInstallation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GitHubWorkspaceRepository" (
    "id" TEXT NOT NULL,
    "githubRepositoryId" BIGINT NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultBranch" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "lastRemoteCommitSha" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    CONSTRAINT "GitHubWorkspaceRepository_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GitHubWorkspaceRepositoryFile" (
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "remoteBlobSha" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    CONSTRAINT "GitHubWorkspaceRepositoryFile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GitHubConnectionAttempt_stateHash_key" ON "GitHubConnectionAttempt"("stateHash");
CREATE INDEX "GitHubConnectionAttempt_workspaceId_expiresAt_idx" ON "GitHubConnectionAttempt"("workspaceId", "expiresAt");
CREATE INDEX "GitHubConnectionAttempt_userId_expiresAt_idx" ON "GitHubConnectionAttempt"("userId", "expiresAt");
CREATE UNIQUE INDEX "GitHubWorkspaceInstallation_workspaceId_key" ON "GitHubWorkspaceInstallation"("workspaceId");
CREATE INDEX "GitHubWorkspaceInstallation_githubInstallationId_idx" ON "GitHubWorkspaceInstallation"("githubInstallationId");
CREATE UNIQUE INDEX "GitHubWorkspaceRepository_workspaceId_key" ON "GitHubWorkspaceRepository"("workspaceId");
CREATE UNIQUE INDEX "GitHubWorkspaceRepository_installationId_key" ON "GitHubWorkspaceRepository"("installationId");
CREATE INDEX "GitHubWorkspaceRepository_githubRepositoryId_idx" ON "GitHubWorkspaceRepository"("githubRepositoryId");
CREATE UNIQUE INDEX "GitHubWorkspaceRepositoryFile_documentId_key" ON "GitHubWorkspaceRepositoryFile"("documentId");
CREATE UNIQUE INDEX "GitHubWorkspaceRepositoryFile_repositoryId_path_key" ON "GitHubWorkspaceRepositoryFile"("repositoryId", "path");
CREATE INDEX "GitHubWorkspaceRepositoryFile_repositoryId_updatedAt_idx" ON "GitHubWorkspaceRepositoryFile"("repositoryId", "updatedAt");

ALTER TABLE "GitHubConnectionAttempt" ADD CONSTRAINT "GitHubConnectionAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GitHubConnectionAttempt" ADD CONSTRAINT "GitHubConnectionAttempt_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GitHubWorkspaceInstallation" ADD CONSTRAINT "GitHubWorkspaceInstallation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GitHubWorkspaceInstallation" ADD CONSTRAINT "GitHubWorkspaceInstallation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GitHubWorkspaceRepository" ADD CONSTRAINT "GitHubWorkspaceRepository_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GitHubWorkspaceRepository" ADD CONSTRAINT "GitHubWorkspaceRepository_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "GitHubWorkspaceInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GitHubWorkspaceRepository" ADD CONSTRAINT "GitHubWorkspaceRepository_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GitHubWorkspaceRepositoryFile" ADD CONSTRAINT "GitHubWorkspaceRepositoryFile_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "GitHubWorkspaceRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GitHubWorkspaceRepositoryFile" ADD CONSTRAINT "GitHubWorkspaceRepositoryFile_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
