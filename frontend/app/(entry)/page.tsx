import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/auth-guards";
import { getUnauthenticatedAuthRoute, resolvePostAuthRoute } from "@/service/actions/auth-routing";

export default async function HomePage() {
    const session = await getServerSession();

    redirect(session?.user ? await resolvePostAuthRoute() : await getUnauthenticatedAuthRoute());
}
