import type { JsonValue } from "@/service/types/broker";

export interface AlphaConcall {
    id: string;
    symbol: string;
    summary?: string | null;
    completion_response?: string | null;
    analysis?: JsonValue;
    expanded_analysis?: JsonValue;
    short_analysis?: JsonValue;
    quarter?: string | null;
    month?: string | null;
    filename?: string | null;
    type?: string | null;
    uploaded_file_type?: string | null;
    date?: string | null;
    concall_type?: string | null;
    transcript_pdf_links?: string[];
    recording_links?: string[];
    pdf_r2_key?: string | null;
    audio_r2_key?: string | null;
    automated_processing_capable?: boolean | null;
    is_concall?: boolean | null;
}
