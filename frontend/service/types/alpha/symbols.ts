export interface AlphaSymbolMetadata {
    symbol: string;
    company_name?: string | null;
    logo?: string | null;
    market_cap?: number | null;
    sector?: string | null;
    basic_industry?: string | null;
    industry?: string | null;
    macro_economic_indicator?: string | null;
    theme?: string | null;
    scrip_code?: string | null;
}

export interface AlphaSymbolMetadataResponse {
    data: AlphaSymbolMetadata[];
}
