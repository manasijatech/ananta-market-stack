import type { JsonValue } from "@/service/types/broker";

export interface AlphaConcallAnalysisSections {
    [section: string]: string | null;
}

export interface AlphaConcallSentimentIndicators {
    positive?: string[];
    negative?: string[];
    [key: string]: string[] | undefined;
}

export interface AlphaConcallSentiment {
    score?: number | null;
    classification?: string | null;
    key_indicators?: AlphaConcallSentimentIndicators | null;
}

export interface AlphaConcallSentimentAnalysis {
    sentiment?: AlphaConcallSentiment | null;
    [key: string]: JsonValue | AlphaConcallSentiment | undefined;
}

export interface AlphaConcall {
    id: string;
    symbol: string;
    summary?: string | null;
    completion_response?: string | null;
    analysis?: JsonValue;
    expanded_analysis?: AlphaConcallAnalysisSections | JsonValue;
    short_analysis?: AlphaConcallAnalysisSections | JsonValue;
    sentiment_analysis?: AlphaConcallSentimentAnalysis | JsonValue;
    quarter?: string | null;
    month?: string | null;
    filename?: string | null;
    type?: string | null;
    uploaded_file_type?: string | null;
    date?: string | null;
    concall_type?: string | null;
    transcript_url?: string | null;
    audio_url?: string | null;
    transcript_pdf_links?: string[];
    recording_links?: string[];
    pdf_r2_key?: string | null;
    audio_r2_key?: string | null;
    automated_processing_capable?: boolean | null;
    is_concall?: boolean | null;
}
