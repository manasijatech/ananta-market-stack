"use client";

import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGithubStars } from "@/hooks/use-github-stars";
import { formatStarCount, GITHUB_REPO_URL } from "@/lib/github";
import { cn } from "@/lib/utils";

export function GithubStarButton({ className }: { className?: string }) {
    const { data: stars } = useGithubStars();

    return (
        <Button asChild className={cn(className)} variant="outline">
            <a href={GITHUB_REPO_URL} rel="noopener noreferrer" target="_blank">
                <Star className="size-4" />
                Star
                {typeof stars === "number" ? (
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
                        {formatStarCount(stars)}
                    </span>
                ) : null}
            </a>
        </Button>
    );
}
