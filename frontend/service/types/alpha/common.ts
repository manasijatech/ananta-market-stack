import type {
    AttachmentLookupItem,
    BatchAttachmentLookupResponse,
    PaginatedResponse,
    PresignedUrlResponse,
    StringListResponse
} from "@manasija/market-stack-sdk";

export type AlphaPaginatedResponse<T> = PaginatedResponse<T>;
export type AlphaStringListResponse = StringListResponse;
export type AlphaAttachmentLookupItem = AttachmentLookupItem;
export type AlphaAttachmentLookupResponse = BatchAttachmentLookupResponse;
export type AlphaPresignedUrlResponse = PresignedUrlResponse;
