"use client";

import { Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useGithubStars } from "@/hooks/use-github-stars";
import { formatStarCount, GITHUB_REPO_URL } from "@/lib/github";
import { cn } from "@/lib/utils";

/** External link showing the public GitHub repository star count. */
export function GithubStarButton({ className }: { className?: string }) {
    const { data } = useGithubStars();
    const stars = data?.stars;

    return (
        <Button
            aria-label={
                typeof stars === "number"
                    ? `Star on GitHub (${formatStarCount(stars)} stars)`
                    : "Star on GitHub"
            }
            className={cn("h-9 rounded-lg px-3 text-sm gap-1.5", className)}
            render={<a href={GITHUB_REPO_URL} rel="noopener noreferrer" target="_blank" />}
            type="button"
            variant="outline"
        >
            <Star className="size-3.5" />
            Star
            {typeof stars === "number" ? (
                <Badge size="sm" variant="secondary">
                    {formatStarCount(stars)}
                </Badge>
            ) : null}
        </Button>
    );
}
