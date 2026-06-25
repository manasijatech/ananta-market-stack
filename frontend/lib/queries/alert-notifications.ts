import {
    getAlertNotifications,
    getAlertUnreadCount
} from "@/service/actions/alerts";
import type { AlertNotification } from "@/service/types/alerts";

export type AlertNotificationTrayData = {
    unreadCount: number;
    items: AlertNotification[];
};

export async function fetchAlertNotificationTray(): Promise<AlertNotificationTrayData> {
    const [count, notifications] = await Promise.all([
        getAlertUnreadCount(),
        getAlertNotifications({ unread_only: true, limit: 8 })
    ]);

    return {
        unreadCount: count.unread_count,
        items: notifications
    };
}
