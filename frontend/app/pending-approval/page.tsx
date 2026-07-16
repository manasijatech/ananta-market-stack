import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth-guards";
import { resolvePostAuthRoute } from "@/service/actions/auth-routing";
import { PendingApprovalView } from "./pending-approval-view";

/** Gate for users with a valid session but inactive RBAC status. */
export default async function PendingApprovalPage() {
    await requireSession();

    try {
        const route = await resolvePostAuthRoute();
        if (route !== "/pending-approval") {
            redirect(route);
        }
    } catch {
        // Backend may be unavailable; the client view can retry.
    }

    return <PendingApprovalView />;
}
