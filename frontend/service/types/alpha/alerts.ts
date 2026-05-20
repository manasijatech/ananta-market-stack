import type { JsonObject } from "@/service/types/broker";

export interface AlphaAlert {
    id: string;
    symbol: string;
    type?: string | null;
    reason?: string | null;
    timestamp?: string | null;
    meta?: JsonObject;
}
