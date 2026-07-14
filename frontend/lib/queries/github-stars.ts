import { unstable_cache } from "next/cache";
import { GITHUB_REPO_NAME, GITHUB_REPO_OWNER } from "@/lib/github";

const MAX_STARGAZERS = 100;

export type GithubStargazer = {
    id: number;
    login: string;
    avatarUrl: string;
    htmlUrl: string;
};

export type GithubStarsPayload = {
    stars: number | null;
    stargazers: GithubStargazer[];
    stargazersRequiresAuth?: boolean;
};

type GithubStargazerResponse = {
    id?: number;
    login?: string;
    avatar_url?: string;
    html_url?: string;
};

function githubHeaders(): HeadersInit {
    const token = process.env.GITHUB_TOKEN ?? process.env.GITHUB_ACCESS_TOKEN;
    return {
        Accept: "application/vnd.github+json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "User-Agent": "ananta-market-stack"
    };
}

function nextPageUrl(linkHeader: string | null): string | null {
    if (!linkHeader) {
        return null;
    }

    const nextLink = linkHeader
        .split(",")
        .map((link) => link.trim())
        .find((link) => link.endsWith('rel="next"'));

    return nextLink?.match(/<([^>]+)>/)?.[1] ?? null;
}

async function fetchGithubStarCount(): Promise<number | null> {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}`, {
        headers: githubHeaders()
    });

    if (!response.ok) {
        return null;
    }

    const data = (await response.json()) as { stargazers_count?: number };
    return typeof data.stargazers_count === "number" ? data.stargazers_count : null;
}

async function _fetchGithubStargazers(): Promise<Pick<GithubStarsPayload, "stargazers" | "stargazersRequiresAuth">> {
    const stargazers: GithubStargazer[] = [];
    let url: string | null =
        `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/stargazers?per_page=100`;

    while (url && stargazers.length < MAX_STARGAZERS) {
        const response = await fetch(url, {
            headers: githubHeaders()
        });

        if (!response.ok) {
            return {
                stargazers,
                stargazersRequiresAuth: response.status === 401 || response.status === 403
            };
        }

        const data = (await response.json()) as GithubStargazerResponse[];
        for (const stargazer of data) {
            if (
                typeof stargazer.id === "number" &&
                typeof stargazer.login === "string" &&
                typeof stargazer.avatar_url === "string" &&
                typeof stargazer.html_url === "string"
            ) {
                stargazers.push({
                    id: stargazer.id,
                    login: stargazer.login,
                    avatarUrl: stargazer.avatar_url,
                    htmlUrl: stargazer.html_url
                });
            }

            if (stargazers.length >= MAX_STARGAZERS) {
                break;
            }
        }

        url = nextPageUrl(response.headers.get("Link"));
    }

    return { stargazers, stargazersRequiresAuth: false };
}

async function fetchGithubStarsFromGitHubUncached(): Promise<GithubStarsPayload> {
    const stars = await fetchGithubStarCount();

    // Stargazer profile UI is parked for now. Keep the fetch helper above so it can
    // be re-enabled later without rebuilding the GitHub API integration.
    // const stargazerDetails = await _fetchGithubStargazers();
    const stargazerDetails = { stargazers: [], stargazersRequiresAuth: false };

    return { stars, ...stargazerDetails };
}

/** Cached GitHub star details (revalidated hourly). Used by the `/api/github-stars` route. */
export const fetchGithubStarsFromGitHub = unstable_cache(
    fetchGithubStarsFromGitHubUncached,
    ["github-stars", GITHUB_REPO_OWNER, GITHUB_REPO_NAME],
    { revalidate: 3600 }
);

/**
 * Fetches the public star count via the Next.js API route.
 * Keeps GitHub API calls on the server.
 */
export async function fetchGithubStars(): Promise<GithubStarsPayload> {
    const response = await fetch("/api/github-stars");
    if (!response.ok) {
        return { stars: null, stargazers: [] };
    }

    const data = (await response.json()) as Partial<GithubStarsPayload>;
    return {
        stars: typeof data.stars === "number" ? data.stars : null,
        stargazers: Array.isArray(data.stargazers) ? data.stargazers : [],
        stargazersRequiresAuth: data.stargazersRequiresAuth === true
    };
}
