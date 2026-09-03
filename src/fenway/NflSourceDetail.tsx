import type { ReactNode } from 'react';
import type { BriefSource } from '@shared/types';
import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';

const URL_KEYS = new Set(['source_url', 'url', 'authoritative_url']);
const HIDDEN_KEYS = new Set([
  'dataset_id',
  'event_id',
  'analysis_id',
  'player_id',
  'source_ref_ids',
  'raw_source_record',
  'snapshot_id',
  'rows',
  'contribution',
  'authority_label',
  'authority_type',
  'source_status',
  'evidence_status',
  'provenance',
  'source_hash',
  'checksum_sha256',
  'rule_family',
  'transaction',
  'seller_move_contract',
  'seller_move_role',
  'seller_move_rule',
  'seller_move_comparable',
  'current_team_cap_summary',
  'current_team_contract',
  'current_team_roster',
  'current_team_depth',
  'current_team_role_history',
]);
const MAX_RECORDS = 30;

export function NflSourceDetail({ source, onBack }: { source: BriefSource; onBack: () => void }) {
  const data = isRecord(source.data) ? source.data : {};
  const asOf = firstStringDeep(data, ['as_of_date', 'as_of', 'season']) ?? source.updated_at;
  const boundary = firstStringDeep(data, ['authority_label', 'authority', 'source_document']) ?? sourceAuthority(source);
  const contribution = typeof data.contribution === 'string' ? data.contribution : null;
  const rows = detailRows(data);
  const remainingData = Object.fromEntries(Object.entries(data).filter(([key]) => !HIDDEN_KEYS.has(key) && !URL_KEYS.has(key)));
  const sourceUrls = collectUrls(data);

  return (
    <div className="gd-scroll" style={{ height: '100%', overflowY: 'auto', padding: SPACE.lg }}>
      <button type="button" onClick={onBack} style={{
        border: 'none', background: 'transparent', color: F.fenway,
        padding: 0, cursor: 'pointer', fontWeight: 700, fontSize: TYPE.body.sm,
      }}>← Evidence for this answer</button>
      <div style={{ marginTop: SPACE['2xl'] }}>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.xs, fontWeight: 700,
          color: F.fenway, textTransform: 'uppercase', letterSpacing: TRACKING.micro,
        }}>{sourceKindLabel(source)}</span>
        <h2 style={{ margin: `${SPACE.sm}px 0`, fontFamily: 'var(--font-display)', fontSize: TYPE.display.lg }}>{source.title}</h2>
        <p style={{ margin: 0, color: F.fgMuted, fontSize: TYPE.body.sm }}>{source.source ?? 'Public NFL source'}</p>
      </div>
      <dl style={{ margin: `${SPACE['2xl']}px 0`, borderTop: `1px solid ${F.border}` }}>
        <Fact label="As of" value={asOf ?? 'Not supplied'} />
        <Fact label="Authority" value={boundary} />
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

      {hasVisibleData(remainingData) && <StructuredValue value={remainingData} />}

      {sourceUrls.length > 0 && (
        <section style={{ marginTop: SPACE.xl }}>
          <SectionLabel>Source links</SectionLabel>
          <div style={{ display: 'grid', gap: SPACE.sm }}>
            {sourceUrls.slice(0, 12).map((url) => (
              <a key={url} href={url} target="_blank" rel="noreferrer" style={{
                color: F.fenway, fontSize: TYPE.body.sm, fontWeight: 700, overflowWrap: 'anywhere',
              }}>Open {sourceLabel(url)} ↗</a>
            ))}
            {sourceUrls.length > 12 && <small style={{ color: F.fgMuted }}>Additional source links are available.</small>}
          </div>
        </section>
      )}
    </div>
  );
}

function StructuredValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (isPrimitive(value)) return <span>{displayValue(value)}</span>;

  if (Array.isArray(value)) {
    if (value.length === 0) return <EmptyState>No rows captured.</EmptyState>;
    const visible = value.slice(0, MAX_RECORDS);
    const kvRows = visible.every((item) => isRecord(item) && ('k' in item || 'key' in item));
    if (kvRows) {
      return <dl style={{ margin: 0, borderTop: `1px solid ${F.border}` }}>{visible.map((item, index) => {
        const row = item as Record<string, unknown>;
        return <Fact key={`${String(row.k ?? row.key)}-${index}`} label={String(row.k ?? row.key)} value={displayValue(row.v ?? row.value)} />;
      })}</dl>;
    }
    return <div style={{ display: 'grid', gap: SPACE.sm }}>
      {visible.map((item, index) => isRecord(item)
        ? <RecordCard key={index} record={item} index={index} depth={depth} />
        : <Fact key={index} label={`Item ${index + 1}`} value={displayValue(item)} />)}
      {value.length > MAX_RECORDS && <EmptyState>Showing the first {MAX_RECORDS} of {value.length} captured rows.</EmptyState>}
    </div>;
  }

  if (!isRecord(value)) return <span>{displayValue(value)}</span>;
  const entries = Object.entries(value).filter(([key]) => !URL_KEYS.has(key) && !HIDDEN_KEYS.has(key));
  const primitiveEntries = entries.filter(([, item]) => isPrimitive(item));
  const nestedEntries = entries.filter(([, item]) => !isPrimitive(item) && hasVisibleData(item));
  return <div style={{ display: 'grid', gap: SPACE.md }}>
    {primitiveEntries.length > 0 && <dl style={{ margin: 0, borderTop: `1px solid ${F.border}` }}>{primitiveEntries.map(([key, item]) => <Fact key={key} label={key} value={displayValue(item)} />)}</dl>}
    {nestedEntries.map(([key, item]) => <section key={key} style={{ marginTop: depth ? SPACE.sm : SPACE.md }}>
      <SectionLabel>{label(key)}</SectionLabel>
      <StructuredValue value={item} depth={depth + 1} />
    </section>)}
  </div>;
}

function RecordCard({ record, index, depth }: { record: Record<string, unknown>; index: number; depth: number }) {
  const title = firstString(record, ['player_name', 'player', 'name', 'title', 'rule_family']) ?? `Record ${index + 1}`;
  const urls = collectUrls(record);
  return <article style={{
    border: `1px solid ${F.border}`, borderRadius: RADIUS.md, background: F.surface,
    padding: SPACE.md, minWidth: 0,
  }}>
    <strong style={{ display: 'block', marginBottom: SPACE.sm, color: F.ink, fontSize: TYPE.body.sm }}>{title}</strong>
    <StructuredValue value={record} depth={depth + 1} />
    {urls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer" style={{
      display: 'block', marginTop: SPACE.sm, color: F.fenway, fontSize: TYPE.meta.md,
      fontWeight: 700, overflowWrap: 'anywhere',
    }}>Open source ↗</a>)}
  </article>;
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

function EmptyState({ children }: { children: ReactNode }) {
  return <div style={{
    padding: SPACE.md, border: `1px solid ${F.border}`, borderRadius: RADIUS.md,
    background: F.surface, color: F.fgMuted, fontSize: TYPE.body.sm, lineHeight: 1.45,
  }}>{children}</div>;
}

function firstString(data: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) if (typeof data[key] === 'string' && data[key]) return data[key] as string;
  return null;
}

function firstStringDeep(value: unknown, keys: string[]): string | null {
  if (isRecord(value)) {
    const direct = firstString(value, keys);
    if (direct) return direct;
    for (const item of Object.values(value)) {
      const nested = firstStringDeep(item, keys);
      if (nested) return nested;
    }
  } else if (Array.isArray(value)) {
    for (const item of value) {
      const nested = firstStringDeep(item, keys);
      if (nested) return nested;
    }
  }
  return null;
}

function collectUrls(value: unknown, urls = new Set<string>()): string[] {
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (URL_KEYS.has(key) && typeof item === 'string' && isSafeUrl(item)) urls.add(item);
      else if ((key === 'k' || key === 'key') && /(?:source|upstream).*url|upstream source/i.test(String(item))) {
        const candidate = value.v ?? value.value;
        if (typeof candidate === 'string' && isSafeUrl(candidate)) urls.add(candidate);
      }
      else collectUrls(item, urls);
    }
  } else if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, urls);
  }
  return [...urls];
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

function isPrimitive(value: unknown): value is string | number | boolean | null | undefined {
  return value == null || ['string', 'number', 'boolean'].includes(typeof value);
}

function hasVisibleData(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasVisibleData);
  if (!isRecord(value)) return value != null;
  return Object.entries(value).some(([key, item]) => (
    !URL_KEYS.has(key) && !HIDDEN_KEYS.has(key) && (isPrimitive(item) || hasVisibleData(item))
  ));
}

function displayValue(value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

function label(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function sourceKindLabel(source: BriefSource): string {
  if (source.kind !== 'ANALYST_DATA') return source.kind.replace(/_/g, ' ');
  if (source.data?.seller_move_role === true) return 'Roster source';
  if (source.data?.seller_move_comparable === true) return 'Transaction source';
  return 'Public data';
}

function detailRows(data: Record<string, unknown>): Array<{ k: string; v: string }> {
  if (!Array.isArray(data.rows)) return [];
  return data.rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.k !== 'string') return [];
    return [{ k: row.k, v: displayValue(row.v) }];
  });
}

function sourceAuthority(source: BriefSource): string {
  if (source.kind === 'CBA') return 'Executed NFL-NFLPA collective bargaining agreement';
  if (source.kind === 'ROSTER') return 'Official public roster';
  if (source.kind === 'CONTRACT' || source.kind === 'CAP') return 'Public contract and cap source';
  return 'Public NFL data source';
}
