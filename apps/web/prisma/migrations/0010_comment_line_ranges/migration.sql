ALTER TABLE "DocumentComment"
ADD COLUMN "lineStart" INTEGER,
ADD COLUMN "lineEnd" INTEGER;

ALTER TABLE "DocumentComment"
ADD CONSTRAINT "DocumentComment_line_range_check"
CHECK (
  ("lineStart" IS NULL AND "lineEnd" IS NULL)
  OR
  ("lineStart" IS NOT NULL AND "lineEnd" IS NOT NULL AND "lineStart" >= 1 AND "lineEnd" >= "lineStart")
);
