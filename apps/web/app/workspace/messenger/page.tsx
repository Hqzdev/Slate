import { redirect } from "next/navigation";

export default async function WorkspaceMessengerRoute({ searchParams }: { searchParams: Promise<{ workspaceId?: string | string[] }> }) {
  const { workspaceId } = await searchParams;
  const selectedWorkspaceId = Array.isArray(workspaceId) ? workspaceId[0] : workspaceId;
  const workspaceQuery = selectedWorkspaceId ? `&workspaceId=${encodeURIComponent(selectedWorkspaceId)}` : "";
  redirect(`/workspace?view=dashboard${workspaceQuery}`);
}
