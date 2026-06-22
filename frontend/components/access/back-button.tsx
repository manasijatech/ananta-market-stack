"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

export function BackButton({ fallbackHref = "/dashboard" }: { fallbackHref?: string }) {
    const router = useRouter();

    return (
        <Button
            onClick={() => {
                if (window.history.length > 1) {
                    router.back();
                    return;
                }
                router.push(fallbackHref);
            }}
            type="button"
            variant="outline"
        >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Go back
        </Button>
    );
}
