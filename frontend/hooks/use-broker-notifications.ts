"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { getNotifications, markNotificationRead } from "@/service/actions/broker";
import type { Notification } from "@/service/types/broker";

async function fetchUnreadBrokerNotifications(): Promise<Notification[]> {
    return (await getNotifications()).filter((item) => !item.is_read);
}

export function useBrokerNotifications() {
    return useQuery({
        queryKey: queryKeys.broker.notifications(),
        queryFn: fetchUnreadBrokerNotifications
    });
}

export function useMarkBrokerNotificationRead() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: markNotificationRead,
        onSuccess: (_, notificationId) => {
            queryClient.setQueryData<Notification[]>(queryKeys.broker.notifications(), (current) =>
                current?.filter((item) => item.id !== notificationId)
            );
        }
    });
}
