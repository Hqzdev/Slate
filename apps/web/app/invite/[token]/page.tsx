import { InvitePage } from "@/components/InvitePage";

export default async function WorkspaceInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InvitePage token={token} />;
}
