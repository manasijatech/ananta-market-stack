export const queryKeys = {
    github: {
        all: ["github"] as const,
        stars: () => [...queryKeys.github.all, "stars"] as const
    },
    deployment: {
        all: ["deployment"] as const,
        updateStatus: () => [...queryKeys.deployment.all, "update-status"] as const
    },
    broker: {
        all: ["broker"] as const,
        notifications: () => [...queryKeys.broker.all, "notifications"] as const
    },
    alerts: {
        all: ["alerts"] as const,
        notificationTray: () => [...queryKeys.alerts.all, "notification-tray"] as const
    },
    auth: {
        all: ["auth"] as const,
        postAuthRoute: () => [...queryKeys.auth.all, "post-auth-route"] as const
    }
} as const;
