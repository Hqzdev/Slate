import assert from "node:assert/strict";
import test from "node:test";
import { aiAgentSystemPrompt, aiAgentTools } from "../lib/server/ai/agentTools";

test("agent exposes only bounded Slate capabilities", () => {
  assert.deepEqual(aiAgentTools.map((tool) => tool.name), [
    "list_workspace_files",
    "read_document",
    "update_document",
    "create_document",
    "create_note",
    "create_table_note",
    "create_canvas_diagram",
    "run_document",
    "inspect_run"
  ]);
  assert.doesNotMatch(aiAgentTools.map((tool) => tool.name).join(" "), /shell|filesystem|database|secret|network/i);
});

test("agent runtime is explicitly restricted to Slate and confirmed work", () => {
  assert.match(aiAgentSystemPrompt, /confirmed request and plan/);
  assert.match(aiAgentSystemPrompt, /no filesystem, database, secret, device, network, or arbitrary shell access/);
  assert.match(aiAgentSystemPrompt, /Read a document completely before updating it/);
});
