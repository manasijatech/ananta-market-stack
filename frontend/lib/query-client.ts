import { QueryClient, isServer } from "@tanstack/react-query";

function makeQueryClient() {
    return new QueryClient({
        defaultOptions: {
            queries: {
                staleTime: 30_000,
                refetchOnWindowFocus: false,
                retry: 1
            }
        }
    });
}

let browserQueryClient: QueryClient | undefined;

/**
 * Returns a React Query client appropriate for the current runtime.
 *
 * - **Server:** A new client per request to avoid cross-request cache leaks.
 * - **Browser:** A module singleton so cache survives navigations.
 */
export function getQueryClient() {
    if (isServer) {
        return makeQueryClient();
    }

    if (!browserQueryClient) {
        browserQueryClient = makeQueryClient();
    }

    return browserQueryClient;
}
