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

export function getQueryClient() {
    if (isServer) {
        return makeQueryClient();
    }

    if (!browserQueryClient) {
        browserQueryClient = makeQueryClient();
    }

    return browserQueryClient;
}
