"use client";

import { Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useGithubStars } from "@/hooks/use-github-stars";
import { formatStarCount, GITHUB_REPO_URL } from "@/lib/github";
import { cn } from "@/lib/utils";

/** External link showing the public GitHub repository star count. */
export function GithubStarButton({ className }: { className?: string }) {
    const { data: stars } = useGithubStars();

    return (
        <Badge
            aria-label={
                typeof stars === "number"
                    ? `Star on GitHub (${formatStarCount(stars)} stars)`
                    : "Star on GitHub"
            }
            className={cn("gap-1.5", className)}
            render={<a href={GITHUB_REPO_URL} rel="noopener noreferrer" target="_blank" />}
            size="lg"
            variant="outline"
        >
            <Star className="size-3.5" />
            Star
            {typeof stars === "number" ? (
                <Badge size="sm" variant="secondary">
                    {formatStarCount(stars)}
                </Badge>
            ) : null}
        </Badge>
    );
}
