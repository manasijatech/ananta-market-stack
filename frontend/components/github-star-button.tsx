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
            className={cn("max-w-full gap-1.5", className)}
            render={<a href={GITHUB_REPO_URL} rel="noopener noreferrer" target="_blank" />}
            size="lg"
            variant="outline"
        >
            <Star className="size-3.5 shrink-0" />
            <span className="hidden min-[480px]:inline">Star</span>
            {typeof stars === "number" ? (
                <Badge className="hidden min-[480px]:inline-flex" size="sm" variant="secondary">
                    {formatStarCount(stars)}
                </Badge>
            ) : null}
            {typeof stars === "number" ? (
                <span className="sr-only min-[480px]:hidden">{formatStarCount(stars)} stars</span>
            ) : null}
        </Badge>
    );
}
