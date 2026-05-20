export interface AlphaPaginatedResponse<T> {
    data: T[];
    has_next?: boolean;
}

export interface AlphaStringListResponse {
    data: string[];
}

export interface AlphaAttachmentLookupItem {
    id: string;
    status: string;
    url?: string | null;
    expires_in?: number | null;
    message?: string | null;
}

export interface AlphaAttachmentLookupResponse {
    data: AlphaAttachmentLookupItem[];
}

export interface AlphaPresignedUrlResponse {
    url: string;
    expires_in?: number | null;
}
