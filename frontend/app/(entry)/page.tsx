import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth-guards";
import { getUnauthenticatedAuthRoute, resolvePostAuthRoute } from "@/service/actions/auth-routing";

export default async function HomePage() {
    const session = await getServerSession();

    const route = session?.user
        ? await resolvePostAuthRoute().catch(() => "/pending-approval" as const)
        : await getUnauthenticatedAuthRoute();

    redirect(route);
}
