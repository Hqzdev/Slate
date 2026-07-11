CREATE TYPE "AiMessageMode" AS ENUM ('ask', 'plan', 'agent');
ALTER TABLE "AiMessage" ADD COLUMN "mode" "AiMessageMode" NOT NULL DEFAULT 'ask';
