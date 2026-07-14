import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    output: "standalone",
    reactStrictMode: true,
    experimental: {
        // Re-enable client-side Router Cache reuse on navigation. Next 15+ defaults
        // `dynamic` to 0, so revisiting a route refetches/re-renders and re-trips
        // loading.tsx every time. Caching the rendered payload for a short window
        // makes back/forward and quick re-navigation instant (no loading flash).
        // Trade-off: a revisited route can be up to `dynamic` seconds stale — fine
        // here since live prices stream over the client websocket independently.
        staleTimes: {
            dynamic: 30,
            static: 180
        }
    },
    async redirects() {
        return [
            {
                source: "/alerts",
                destination: "/alerts-workspace",
                permanent: false
            },
            {
                source: "/alerts/:path*",
                destination: "/alerts-workspace/:path*",
                permanent: false
            },
            {
                source: "/brokers/docs",
                destination: "/docs",
                permanent: false
            },
            {
                source: "/brokers/docs/:path*",
                destination: "/docs/:path*",
                permanent: false
            },
            {
                source: "/brokers",
                destination: "/broker-connections",
                permanent: false
            },
            {
                source: "/brokers/:path*",
                destination: "/broker-connections/:path*",
                permanent: false
            },
            {
                source: "/dashboard/system-config",
                destination: "/settings",
                permanent: false
            },
            {
                source: "/system-config",
                destination: "/settings",
                permanent: false
            },
            {
                source: "/dashboard/broker-data",
                destination: "/settings",
                permanent: false
            },
            {
                source: "/alert-channels",
                destination: "/settings",
                permanent: false
            }
        ];
    }
};

export default nextConfig;
