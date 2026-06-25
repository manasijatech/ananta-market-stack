import { GITHUB_REPO_NAME, GITHUB_REPO_OWNER } from "@/lib/github";

export async function GET(): Promise<Response> {
    try {
        const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}`, {
            headers: {
                Accept: "application/vnd.github+json",
                "User-Agent": "ananta-market-stack"
            },
            next: { revalidate: 3600 }
        });

        if (!response.ok) {
            return Response.json({ stars: null });
        }

        const data = (await response.json()) as { stargazers_count?: number };
        return Response.json({ stars: typeof data.stargazers_count === "number" ? data.stargazers_count : null });
    } catch {
        return Response.json({ stars: null });
    }
}
