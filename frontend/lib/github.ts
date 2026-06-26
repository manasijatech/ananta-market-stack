export const GITHUB_REPO_OWNER = "manasijatech";
export const GITHUB_REPO_NAME = "ananta-market-stack";
export const GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}`;

export function formatStarCount(count: number) {
    if (count >= 1_000_000) {
        return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
    }
    if (count >= 1_000) {
        return `${(count / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
    }
    return String(count);
}
