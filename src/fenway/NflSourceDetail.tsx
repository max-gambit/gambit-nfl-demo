import type { ReactNode } from 'react';
import type { BriefSource } from '@shared/types';
import { F, SPACE, TRACKING, TYPE } from '../theme/fenway';

const URL_KEYS = new Set(['source_url', 'url', 'authoritative_url']);

export function NflSourceDetail({ source, onBack }: { source: BriefSource; onBack: () => void }) {
  const data = isRecord(source.data) ? source.data : {};
  const asOf = humanDate(firstString(data, ['as_of_date', 'as_of', 'season']) ?? source.updated_at);
  const boundary = firstString(data, ['authority_label', 'authority', 'source_document']) ?? sourceAuthority(source);
  const contribution = typeof data.contribution === 'string' ? data.contribution : null;
  const rows = detailRows(source, data);
  const sourceUrls = directUrls(data);

  return (
    <div className="gd-scroll" style={{ height: '100%', overflowY: 'auto', padding: SPACE.lg }}>
      <button type="button" onClick={onBack} style={{
        border: 'none', background: 'transparent', color: F.fenway,
        padding: 0, cursor: 'pointer', fontWeight: 700, fontSize: TYPE.body.sm,
      }}>← Sources for this answer</button>
      <div style={{ marginTop: SPACE['2xl'] }}>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.xs, fontWeight: 700,
          color: F.fenway, textTransform: 'uppercase', letterSpacing: TRACKING.micro,
        }}>{sourceKindLabel(source)}</span>
        <h2 style={{ margin: `${SPACE.sm}px 0`, fontFamily: 'var(--font-display)', fontSize: TYPE.display.lg }}>{source.title}</h2>
        <p style={{ margin: 0, color: F.fgMuted, fontSize: TYPE.body.sm }}>{sourceName(source.source)}</p>
      </div>
      <dl style={{ margin: `${SPACE['2xl']}px 0`, borderTop: `1px solid ${F.border}` }}>
        <Fact label="As of" value={asOf ?? 'Not supplied'} />
        <Fact label="Source type" value={boundary} />
      </dl>

      {contribution && <section style={{ marginBottom: SPACE.xl }}>
        <SectionLabel>What this establishes</SectionLabel>
        <p style={{ margin: 0, color: F.inkSoft, fontSize: TYPE.body.sm, lineHeight: 1.5 }}>{contribution}</p>
      </section>}

      {rows.length > 0 && <section style={{ marginBottom: SPACE.xl }}>
        <SectionLabel>Details</SectionLabel>
        <dl style={{ margin: 0, borderTop: `1px solid ${F.border}` }}>
          {rows.map((row, index) => <Fact key={`${row.k}-${index}`} label={row.k} value={row.v} />)}
        </dl>
      </section>}

      {sourceUrls.length > 0 && (
        <section style={{ marginTop: SPACE.xl }}>
          <SectionLabel>Source links</SectionLabel>
          <div style={{ display: 'grid', gap: SPACE.sm }}>
            {sourceUrls.map((url) => (
              <a key={url} href={url} target="_blank" rel="noreferrer" style={{
                color: F.fenway, fontSize: TYPE.body.sm, fontWeight: 700, overflowWrap: 'anywhere',
              }}>Open exact source on {sourceLabel(url)} ↗</a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Fact({ label: factLabel, value }: { label: string; value: string }) {
  return <div style={{ display: 'grid', gap: 4, padding: `${SPACE.md}px 0`, borderBottom: `1px solid ${F.border}` }}><dt style={{ color: F.fgMuted, fontSize: TYPE.meta.md }}>{label(factLabel)}</dt><dd style={{ margin: 0, color: F.ink, fontSize: TYPE.body.sm, overflowWrap: 'anywhere' }}>{value}</dd></div>;
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div style={{
    marginBottom: SPACE.sm, color: F.fgMuted, fontFamily: 'var(--font-mono)',
    fontSize: TYPE.meta.xs, fontWeight: 700, letterSpacing: TRACKING.micro,
    textTransform: 'uppercase',
  }}>{children}</div>;
}

function firstString(data: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) if (typeof data[key] === 'string' && data[key]) return data[key] as string;
  return null;
}

function directUrls(value: Record<string, unknown>): string[] {
  return [...new Set([...URL_KEYS].flatMap((key) => {
    const item = value[key];
    return typeof item === 'string' && isSafeUrl(item) ? [item] : [];
  }))];
}

function isSafeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function sourceLabel(value: string): string {
  try { return new URL(value).hostname.replace(/^www\./, ''); }
  catch { return 'source'; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function displayValue(value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

function label(value: string): string {
  const labels: Record<string, string> = {
    'overall status': 'Overall coverage',
    readiness: 'Questions this data can answer',
    coverage: 'Data coverage',
    'position groups': 'By position',
    'player signals': 'Relevant players',
    'top gaps': 'What public data cannot confirm',
    'what still needs checking': 'What public data cannot confirm',
    'current roster': 'Giants contracts that could be moved',
    'depth consequence': 'Roster impact',
    'source as of': 'Source date',
  };
  const normalized = value.trim().toLowerCase();
  if (labels[normalized]) return labels[normalized];
  return value.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function sourceKindLabel(source: BriefSource): string {
  if (source.kind !== 'ANALYST_DATA') return source.kind.replace(/_/g, ' ');
  if (source.data?.seller_move_role === true) return 'Roster source';
  if (source.data?.seller_move_comparable === true) return 'Transaction source';
  return 'Public data';
}

function detailRows(source: BriefSource, data: Record<string, unknown>): Array<{ k: string; v: string }> {
  const explicitRows = Array.isArray(data.rows) ? data.rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.k !== 'string') return [];
    if (!allowedDetailLabel(source, row.k)) return [];
    const value = /(?:date|as of|retrieved)$/i.test(row.k) ? humanDate(displayValue(row.v)) : displayValue(row.v);
    return [{ k: row.k, v: value }];
  }) : [];
  const directRows = [
    directFact(data, 'article', 'Article'),
    directFact(data, 'section', 'Section'),
    directFact(data, 'source_locator', 'Locator'),
    directFact(data, 'excerpt', 'What it says'),
  ].filter((row): row is { k: string; v: string } => Boolean(row));
  const seen = new Set<string>();
  return [...directRows, ...explicitRows].filter((row) => {
    const key = `${row.k.toLowerCase()}:${row.v}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20);
}

function allowedDetailLabel(source: BriefSource, value: string): boolean {
  const label = value.trim();
  if (source.data?.current_nfl_evidence && /^(?:dataset|contract field coverage|top cap contracts|position-group cap rollups|seller thesis|counterparty seller|required answer)/i.test(label)) return false;
  if (/^(?:player record|position mapping|identity match|raw position|normalization|source status|rows?|pff position|provider)/i.test(label)) return false;
  const common = /^(?:as of|date|retrieved|source as of|source updated|season|player|position|position groups|team|teams|from|to|move|transaction|compensation|contract terms|relevance|role|depth consequence|current 2026 cap space|2026 cap hit|top 51 active spending|top cap contracts|dead money|applied team cap|accounting|carryover and adjustments|2026 league salary cap|cap space created|next-year cap effect|guaranteed remaining|contract confidence|contract field coverage|attribution|coverage|coverage range|records in this snapshot|current roster|roster players|active cornerbacks considered|explicit first-at-position cornerbacks|player signals|summary|posture|subject team|readiness|overall status|top gaps)$/i;
  const cba = /^(?:article|section|locator|exact location|rule|effective date|authority|citation|what it says|what still needs checking)$/i;
  return common.test(label) || (source.kind === 'CBA' && cba.test(label));
}

function directFact(data: Record<string, unknown>, key: string, label: string): { k: string; v: string } | null {
  const value = data[key];
  if (typeof value !== 'string' || !value.trim()) return null;
  return { k: label, v: value.trim() };
}

function humanDate(value: string | null): string {
  if (!value) return 'Not supplied';
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/);
  if (!match) return value;
  const [, year, month, day] = match;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))));
}

function sourceName(value: string | null): string {
  if (!value) return 'Public NFL source';
  if (value === 'GAMBIT_APP_DATA') return 'Public NFL data';
  return value.replace(/_/g, ' ');
}

function sourceAuthority(source: BriefSource): string {
  if (source.kind === 'CBA') return 'Executed NFL-NFLPA collective bargaining agreement';
  if (source.kind === 'ROSTER') return 'Official public roster';
  if (source.kind === 'CONTRACT' || source.kind === 'CAP') return 'Public contract and cap source';
  return 'Public NFL data source';
}
