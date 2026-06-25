import { fetchGithubStarsFromGitHub } from "@/lib/queries/github-stars";

export async function GET(): Promise<Response> {
    try {
        const stars = await fetchGithubStarsFromGitHub();
        return Response.json({ stars });
    } catch {
        return Response.json({ stars: null });
    }
}
