export type NflAuthorityDomain = 'cba' | 'playing_rules' | 'league_dates';

export interface NflAuthoritySource {
  id: string;
  league: 'NFL';
  domain: NflAuthorityDomain;
  title: string;
  url: string;
  captured_at: string;
  document_date: string | null;
  edition_year: number | null;
  effective_years: [number, number];
  authority_boundary: string;
  sha256: string;
  pdf_page_count?: number;
  unindexed_pdf_pages?: number[];
  landing_url?: string;
}

export interface NflAuthorityPassage {
  id: string;
  source_id: string;
  domain: NflAuthorityDomain;
  title: string;
  locator: string;
  pdf_page: number | null;
  printed_page: string | null;
  url: string;
  text: string;
  season_year: number | null;
  date_label?: string;
  continues_before: boolean;
  continues_after: boolean;
}

export interface NflAuthorityCorpus {
  schema: 'nfl_authority.v1';
  league: 'NFL';
  captured_at: string;
  coverage: string;
  sources: NflAuthoritySource[];
  passages: NflAuthorityPassage[];
}

export interface NflAuthorityQuery {
  question: string;
  domain?: NflAuthorityDomain;
  limit?: number;
}

export interface NflAuthorityMatch {
  passage: NflAuthorityPassage;
  source: NflAuthoritySource;
  score: number;
  matched_terms: string[];
  topic_ids: string[];
}

export interface NflAuthoritySearchResult {
  status: 'supported' | 'unsupported';
  reason: string | null;
  captured_at: string;
  matches: NflAuthorityMatch[];
  topic_ids: string[];
  caveats: string[];
}
