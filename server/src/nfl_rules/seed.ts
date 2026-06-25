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
  source_url: string;
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
    if (!rule.rule_family || !rule.summary || !rule.source_url) {
      throw new Error('NFL rules corpus has an incomplete rule row');
    }
    if (families.has(rule.rule_family)) throw new Error(`NFL rules corpus duplicate rule family ${rule.rule_family}`);
    families.add(rule.rule_family);
  }
}
