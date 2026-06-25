"use client";

import { Star } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatStarCount, GITHUB_REPO_URL } from "@/lib/github";
import { cn } from "@/lib/utils";

export function GithubStarButton({ className }: { className?: string }) {
    const [stars, setStars] = useState<number | null>(null);

    useEffect(() => {
        let cancelled = false;

        async function loadStars() {
            try {
                const response = await fetch("/api/github-stars");
                if (!response.ok) return;
                const data = (await response.json()) as { stars?: number | null };
                if (!cancelled && typeof data.stars === "number") {
                    setStars(data.stars);
                }
            } catch {
                return;
            }
        }

        void loadStars();
        return () => {
            cancelled = true;
        };
    }, []);

    return (
        <Button asChild className={cn(className)} variant="outline">
            <a href={GITHUB_REPO_URL} rel="noopener noreferrer" target="_blank">
                <Star className="size-4" />
                Star
                {stars !== null ? (
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                        {formatStarCount(stars)}
                    </span>
                ) : null}
            </a>
        </Button>
    );
}
