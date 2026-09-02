import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const DEFAULT_NFL_RULES_CORPUS_PATH = fileURLToPath(
  new URL('../../../data/nfl-rules/rules.json', import.meta.url),
);

export interface NflRuleRow {
  rule_family: string;
  title: string;
  summary: string;
  analysis_use: string;
  authority_type: 'executed_cba' | 'nfl_operations';
  source_document: string;
  source_url: string;
  source_locator: string;
  effective_date: string;
  retrieved_at: string;
  source_hash: string | null;
  bounded_excerpt: string;
  analysis_boundary: string;
  source_note: string;
}

export interface NflRulesCorpus {
  schema_version: 1;
  document_id: string;
  title: string;
  season: string;
  as_of_date: string;
  source_name: string;
  source_url: string;
  retrieved_at: string;
  notes: string[];
  rules: NflRuleRow[];
}

export async function loadNflRulesCorpus(path = DEFAULT_NFL_RULES_CORPUS_PATH): Promise<NflRulesCorpus> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as NflRulesCorpus;
  validateNflRulesCorpus(parsed);
  return parsed;
}

export function validateNflRulesCorpus(corpus: NflRulesCorpus): void {
  if (corpus.schema_version !== 1) throw new Error(`unsupported NFL rules schema_version=${String(corpus.schema_version)}`);
  if (!corpus.document_id || !corpus.as_of_date || !corpus.source_name) {
    throw new Error('NFL rules corpus is missing required metadata');
  }
  if (!Array.isArray(corpus.rules) || corpus.rules.length === 0) {
    throw new Error('NFL rules corpus has no rules');
  }
  const families = new Set<string>();
  for (const rule of corpus.rules) {
    if (
      !rule.rule_family
      || !rule.title
      || !rule.summary
      || !rule.analysis_use
      || !rule.authority_type
      || !rule.source_document
      || !rule.source_url
      || !rule.source_locator
      || !rule.effective_date
      || !rule.retrieved_at
      || !rule.bounded_excerpt
      || !rule.analysis_boundary
    ) {
      throw new Error('NFL rules corpus has an incomplete rule row');
    }
    const source = new URL(rule.source_url);
    if (!['nflpaweb.blob.core.windows.net', 'operations.nfl.com'].includes(source.hostname)) {
      throw new Error(`NFL rule ${rule.rule_family} does not use an approved authoritative source`);
    }
    if (rule.authority_type === 'executed_cba' && !rule.source_hash) {
      throw new Error(`NFL rule ${rule.rule_family} is missing its executed-CBA source hash`);
    }
    if (!/(Article|Section|page|heading)/i.test(rule.source_locator)) {
      throw new Error(`NFL rule ${rule.rule_family} lacks an exact authority locator`);
    }
    if (families.has(rule.rule_family)) throw new Error(`NFL rules corpus duplicate rule family ${rule.rule_family}`);
    families.add(rule.rule_family);
  }
}
