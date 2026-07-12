import { redirect } from "next/navigation";
import { authService } from "@/lib/server/auth";

export default async function WorkspaceLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await authService.getCurrentUser();
  if (!user) redirect("/login?next=/workspace");
  if (!user.onboardingCompletedAt) redirect("/onboarding");
  return children;
}
