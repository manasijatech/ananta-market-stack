"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { fetchGithubStars } from "@/lib/queries/github-stars";

const ONE_HOUR_MS = 60 * 60 * 1000;

export function useGithubStars() {
    return useQuery({
        queryKey: queryKeys.github.stars(),
        queryFn: fetchGithubStars,
        staleTime: ONE_HOUR_MS,
        gcTime: ONE_HOUR_MS
    });
}
