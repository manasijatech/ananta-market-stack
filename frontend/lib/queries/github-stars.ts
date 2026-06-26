import { unstable_cache } from "next/cache";
import { GITHUB_REPO_NAME, GITHUB_REPO_OWNER } from "@/lib/github";

async function fetchGithubStarsFromGitHubUncached(): Promise<number | null> {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}`, {
        headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "ananta-market-stack"
        }
    });

    if (!response.ok) {
        return null;
    }

    const data = (await response.json()) as { stargazers_count?: number };
    return typeof data.stargazers_count === "number" ? data.stargazers_count : null;
}

/** Cached GitHub star count (revalidated hourly). Used by the `/api/github-stars` route. */
export const fetchGithubStarsFromGitHub = unstable_cache(
    fetchGithubStarsFromGitHubUncached,
    ["github-stars", GITHUB_REPO_OWNER, GITHUB_REPO_NAME],
    { revalidate: 3600 }
);

/**
 * Fetches the public star count via the Next.js API route.
 * Keeps GitHub API calls on the server.
 */
export async function fetchGithubStars(): Promise<number | null> {
    const response = await fetch("/api/github-stars");
    if (!response.ok) {
        return null;
    }

    const data = (await response.json()) as { stars?: number | null };
    return typeof data.stars === "number" ? data.stars : null;
}
