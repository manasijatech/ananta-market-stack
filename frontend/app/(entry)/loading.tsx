import { BrandLogo } from "@/components/brand-logo";

/**
 * Splash for the `/` entry route ONLY. It lives in the `(entry)` route group so
 * its Suspense boundary wraps just the index redirect — NOT every route.
 *
 * A root `app/loading.tsx` would sit outside every route's own boundary, so on a
 * cold navigation (the whole subtree re-rendering) React shows this outermost
 * fallback before reaching a route's leaf skeleton — making the splash appear on
 * all routes. Scoping it here keeps it to genuine first-load while every other
 * route shows its own loading.tsx skeleton.
 */
export default function EntryLoading() {
    return (
        <main className="app-page-background flex min-h-svh flex-col items-center justify-center gap-6 p-6">
            <BrandLogo imageClassName="text-2xl motion-safe:animate-pulse" />

            <div
                aria-hidden
                className="relative h-1 w-48 overflow-hidden rounded-full bg-muted"
            >
                <div className="absolute inset-0 motion-safe:animate-skeleton rounded-full bg-[length:200%_100%] bg-[linear-gradient(110deg,transparent,color-mix(in_srgb,var(--primary)_70%,transparent),transparent)]" />
            </div>

            <p className="text-sm text-muted-foreground" role="status">
                Preparing your workspace…
            </p>
        </main>
    );
}
