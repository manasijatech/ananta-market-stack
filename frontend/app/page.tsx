"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
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
 <div className="flex aspect-square w-10 shrink-0 items-center justify-center border border-primary font-mono text-[13px] font-black text-primary" aria-hidden="true">
 MS
 </div>
 <p className="font-mono text-xs font-bold uppercase tracking-[0.16em] text-muted-foreground">Opening Market Stack...</p>
 </main>
 );
}
