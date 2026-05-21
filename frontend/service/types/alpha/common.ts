import type {
    AttachmentLookupItem,
    BatchAttachmentLookupResponse,
    ConcallArtifactUrlsResponse,
    ConcallTranscriptBatchResponse,
    PaginatedResponse,
    PresignedUrlResponse,
    StringListResponse,
    SymbolQuarterKey
} from "@manasija/market-stack-sdk";

export type AlphaPaginatedResponse<T> = PaginatedResponse<T>;
export type AlphaStringListResponse = StringListResponse;
export type AlphaAttachmentLookupItem = AttachmentLookupItem;
export type AlphaAttachmentLookupResponse = BatchAttachmentLookupResponse;
export type AlphaPresignedUrlResponse = PresignedUrlResponse;
export type AlphaConcallArtifactUrlsResponse = ConcallArtifactUrlsResponse;
export type AlphaConcallTranscriptBatchResponse = ConcallTranscriptBatchResponse;
export type AlphaSymbolQuarterKey = SymbolQuarterKey;
