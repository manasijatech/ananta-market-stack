import { redirect } from "next/navigation";

/** Legacy preview URL. Chat is now the Adaptive Workspace canvas surface. */
export default function AdaptiveWorkspaceLegacyPage() {
    redirect("/chat");
}
