import { fetchGithubStarsFromGitHub } from "@/lib/queries/github-stars";

const CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400";

/** Public endpoint that exposes the cached GitHub star count for client components. */
export async function GET(): Promise<Response> {
    try {
        const details = await fetchGithubStarsFromGitHub();
        return Response.json(
            details,
            {
                headers: {
                    "Cache-Control": CACHE_CONTROL
                }
            }
        );
    } catch {
        return Response.json({ stars: null, stargazers: [], stargazersRequiresAuth: false });
    }
}
