const DEPLOYMENT_SKEW_PATTERN =
    /failed to find server action|older or newer deployment|chunkloaderror|loading chunk .* failed/i;
const RELOAD_KEY = "ananta:deployment-recovery-at";
const RELOAD_COOLDOWN_MS = 60_000;

function errorText(reason: unknown): string {
    if (reason instanceof Error) {
        return `${reason.name}: ${reason.message}`;
    }
    return typeof reason === "string" ? reason : "";
}

function recoverDeploymentSkew(reason: unknown): void {
    if (!DEPLOYMENT_SKEW_PATTERN.test(errorText(reason))) {
        return;
    }
    const lastReload = Number.parseInt(window.sessionStorage.getItem(RELOAD_KEY) ?? "0", 10);
    if (Date.now() - lastReload < RELOAD_COOLDOWN_MS) {
        return;
    }
    window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
    window.location.reload();
}

window.addEventListener("error", (event) => recoverDeploymentSkew(event.error ?? event.message));
window.addEventListener("unhandledrejection", (event) => recoverDeploymentSkew(event.reason));
