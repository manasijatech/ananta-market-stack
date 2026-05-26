import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    reactStrictMode: true,
    async rewrites() {
        const internalApiBase = (process.env.MARKET_STACK_API_INTERNAL_URL ?? "http://127.0.0.1:8000/api/v1").replace(/\/+$/, "");
        return [
            {
                source: "/api/v1/:path*",
                destination: `${internalApiBase}/:path*`
            }
        ];
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
