export interface AlphaAttachment {
  has_attachment?: boolean;
  url?: string | null;
  mime?: string | null;
}

export interface AlphaSource {
  name?: string | null;
  url?: string | null;
}

export interface AlphaAnnouncementMetadata {
  hash?: string | null;
  is_earnings?: boolean | null;
  category?: string | null;
  related_categories?: string[];
  descriptor?: string | null;
  confidence?: number | null;
  important?: boolean | null;
  research_marked_important?: boolean | null;
  duplicate?: boolean | null;
}

export interface AlphaAnnouncementDetail {
  id: string;
  symbol: string;
  company_name?: string | null;
  image?: string | null;
  date?: string | null;
  headline?: string | null;
  title?: string | null;
  summary?: string | null;
  original_summary?: string | null;
  full_summary?: string | null;
  tags?: string[];
  category?: string | null;
  related_categories?: string[];
  descriptor?: string | null;
  important?: boolean;
  imp_announcement?: boolean;
  research_marked_important?: boolean | null;
  duplicate?: boolean;
  attachment?: AlphaAttachment | null;
  attachment_url?: string | null;
  r2_key?: string | null;
  pdf_r2_key?: string | null;
  sources?: AlphaSource[];
  metadata?: AlphaAnnouncementMetadata | null;
  is_earnings?: boolean | null;
  earnings_significant?: boolean | null;
  management_guidance?: string | null;
}

export interface AlphaAnnouncementBatchResponse {
  data: AlphaAnnouncementDetail[];
  missing_ids?: string[];
}
