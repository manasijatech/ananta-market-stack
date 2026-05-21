"use server";

import type {
    AlphaConcallArtifactUrlsResponse,
    AlphaConcallTranscriptBatchResponse,
    AlphaPaginatedResponse,
    AlphaSymbolQuarterKey
} from "@/service/types/alpha/common";
import type { AlphaConcall } from "@/service/types/alpha/concalls";
import { toConcallsQueryParams, withAlphaSdk, type AlphaFeedParams } from "@/service/actions/alpha/shared";

export type AlphaConcallDetailParams = {
    symbol: string;
    quarter: string;
    detailed?: boolean;
};

export async function getAlphaConcalls(params: AlphaFeedParams = {}): Promise<AlphaPaginatedResponse<AlphaConcall>> {
    return withAlphaSdk<AlphaPaginatedResponse<AlphaConcall>>((client) =>
        client.getConcalls(toConcallsQueryParams(params))
    );
}

export async function getAlphaConcallDetail(params: AlphaConcallDetailParams): Promise<AlphaConcall> {
    const symbol = params.symbol.trim().toUpperCase();
    const quarter = params.quarter.trim();
    const detailParams = params.detailed === undefined ? {} : { detailed: params.detailed };
    return withAlphaSdk<AlphaConcall>((client) => client.getConcallsDetail({ symbol, quarter, ...detailParams }));
}

export async function getAlphaConcallTranscripts(
    items: AlphaSymbolQuarterKey[]
): Promise<AlphaConcallTranscriptBatchResponse> {
    const normalized = items
        .map((item) => ({
            symbol: item.symbol.trim().toUpperCase(),
            quarter: item.quarter.trim()
        }))
        .filter((item) => item.symbol && item.quarter);
    return withAlphaSdk<AlphaConcallTranscriptBatchResponse>((client) =>
        client.postConcallsTranscripts({ items: normalized })
    );
}

export async function getAlphaConcallArtifactUrls(
    symbol: string,
    quarter: string
): Promise<AlphaConcallArtifactUrlsResponse> {
    return withAlphaSdk<AlphaConcallArtifactUrlsResponse>((client) =>
        client.getConcallsTranscript({ symbol: symbol.trim().toUpperCase(), quarter: quarter.trim() })
    );
}
