export interface AlphaPortfolioItem {
  symbol: string;
  exposure: number;
}

export interface AlphaDailySummaryRequest {
  portfolio: AlphaPortfolioItem[];
}

export interface AlphaDailySummaryDetails {
  portfolio_size: number;
  symbols_processed: number;
  request_id: string;
}

export interface AlphaDailySummaryResponse {
  status: string;
  summary?: string | null;
  details?: AlphaDailySummaryDetails | null;
  error?: string | null;
}
