import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    reactStrictMode: true,
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
                destination: "/system-config",
                permanent: false
            },
            {
                source: "/dashboard/broker-data",
                destination: "/system-config",
                permanent: false
            }
        ];
    }
};

export default nextConfig;
