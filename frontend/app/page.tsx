"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { useSession } from "@/components/session-provider";

export default function HomePage() {
 const router = useRouter();
 const { user, isLoading } = useSession();

 useEffect(() => {
 if (isLoading) {
 return;
 }
 router.replace(user ? "/dashboard" : "/auth/sign-in");
 }, [isLoading, router, user]);

 return (
 <main className="flex min-h-screen flex-col items-center justify-center gap-4">
 <BrandLogo imageClassName="h-14 w-64" />
 <p className="font-mono text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Opening Market Stack...</p>
 </main>
 );
}
