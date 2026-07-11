import { redirect } from "next/navigation";

export default function CommentsPage() {
  redirect("/workspace?view=comments");
}
