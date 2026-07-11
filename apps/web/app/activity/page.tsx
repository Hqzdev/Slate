import { redirect } from "next/navigation";

export default function ActivityPage() {
  redirect("/workspace?view=activity");
}
