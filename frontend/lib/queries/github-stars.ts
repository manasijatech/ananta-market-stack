import { GITHUB_REPO_NAME, GITHUB_REPO_OWNER } from "@/lib/github";

export async function fetchGithubStarsFromGitHub(): Promise<number | null> {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}`, {
        headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "ananta-market-stack"
        },
        next: { revalidate: 3600 }
    });

    if (!response.ok) {
        return null;
    }

    const data = (await response.json()) as { stargazers_count?: number };
    return typeof data.stargazers_count === "number" ? data.stargazers_count : null;
}

export async function fetchGithubStars(): Promise<number | null> {
    const response = await fetch("/api/github-stars");
    if (!response.ok) {
        return null;
    }

    const data = (await response.json()) as { stars?: number | null };
    return typeof data.stars === "number" ? data.stars : null;
}
