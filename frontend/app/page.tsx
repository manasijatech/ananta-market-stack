import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getUnauthenticatedAuthRoute } from "@/service/actions/auth-routing";

export default async function HomePage() {
    const session = await auth.api.getSession({
        headers: await headers()
    });

    redirect(session?.user ? "/dashboard" : await getUnauthenticatedAuthRoute());
}
