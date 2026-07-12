const baseUrl = required("MESSENGER_SECURITY_BASE_URL").replace(/\/$/u, "");
const cookie = required("MESSENGER_SECURITY_SESSION_COOKIE");
const workspaceId = required("MESSENGER_SECURITY_WORKSPACE_ID");
const conversationId = required("MESSENGER_SECURITY_CONVERSATION_ID");
const forbiddenWorkspaceId = required("MESSENGER_SECURITY_FORBIDDEN_WORKSPACE_ID");
const forbiddenConversationId = required("MESSENGER_SECURITY_FORBIDDEN_CONVERSATION_ID");

await expectDenied(`/api/workspaces/${encodeURIComponent(forbiddenWorkspaceId)}/messenger/conversations/${encodeURIComponent(forbiddenConversationId)}/messages?limit=1`);
await expectDenied(`/api/workspaces/${encodeURIComponent(workspaceId)}/messenger/conversations/${encodeURIComponent(forbiddenConversationId)}/messages?limit=1`);
await expectDenied(`/api/workspaces/${encodeURIComponent(workspaceId)}/messenger/conversations/${encodeURIComponent(conversationId)}/attachments/forged-attachment/content`);

const originResponse = await fetch(`${baseUrl}/api/workspaces/${encodeURIComponent(workspaceId)}/messenger/conversations/${encodeURIComponent(conversationId)}/receipt`, {
  body: JSON.stringify({ readThroughSequence: "1" }),
  headers: { "content-type": "application/json", cookie, origin: "https://forged.invalid" },
  method: "POST"
});
if (originResponse.status !== 403) throw new Error(`Forged origin returned ${originResponse.status}`);

process.stdout.write(`${JSON.stringify({ idor: "denied", origin: "denied", status: "ok" })}\n`);

async function expectDenied(path) {
  const response = await fetch(`${baseUrl}${path}`, { headers: { accept: "application/json", cookie } });
  const text = await response.text();
  if (response.status !== 404 || /body|fileName|storageKey|participants/iu.test(text)) throw new Error(`Non-enumerating denial failed for ${path}`);
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
