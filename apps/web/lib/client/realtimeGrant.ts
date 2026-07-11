export async function fetchRealtimeGrant(roomName: string) {
  const response = await fetch(`/api/realtime/authorize?room=${encodeURIComponent(roomName)}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error("Realtime authorization failed");
  }

  const body = await response.json() as { grant?: unknown };
  if (typeof body.grant !== "string") {
    throw new Error("Realtime grant missing");
  }

  return body.grant;
}
