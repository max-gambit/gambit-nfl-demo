import type { ReactNode } from 'react';
import { Cite } from '../ds/Cite';
import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';
import type {
  BriefPresentation,
  BriefPresentationBulletItem,
  BriefPresentationSection,
  RecommendationBriefBody,
  RecommendationNextQuestionGroup,
} from '@shared/types';

interface Props {
  body: RecommendationBriefBody;
}

export function TemplateBriefBody({ body }: Props) {
  const presentation = body.presentation;
  if (!presentation?.sections.length) return null;
  return (
    <div style={{ display: 'grid', gap: SPACE.lg, minWidth: 0, maxWidth: '100%' }}>
      {presentation.title && (
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: TYPE.meta.md,
          color: F.fgMuted,
          letterSpacing: TRACKING.micro,
          textTransform: 'uppercase',
          fontWeight: 700,
        }}>{presentation.title}</div>
      )}
      {presentation.sections.map((section, index) => (
        <TemplateSection key={`${section.kind}-${section.title}-${index}`} section={section} />
      ))}
    </div>
  );
}

function TemplateSection({ section }: { section: BriefPresentationSection }) {
  switch (section.kind) {
    case 'prose':
      return (
        <section style={{ minWidth: 0, maxWidth: '100%' }}>
          <SectionLabel>{section.title}</SectionLabel>
          <p style={{
            margin: 0,
            fontFamily: 'var(--font-sans)',
            fontSize: TYPE.body.md,
            lineHeight: 1.6,
            color: F.inkSoft,
            overflowWrap: 'anywhere',
          }}>
            {renderWithCites(section.body)}
            {renderRefs(section.source_refs)}
          </p>
        </section>
      );
    case 'bullets':
      return (
        <section style={{ minWidth: 0, maxWidth: '100%' }}>
          <SectionLabel>{section.title}</SectionLabel>
          <div style={{ display: 'grid', gap: SPACE.xs, minWidth: 0 }}>
            {section.items.map((item, index) => (
              <BulletItem key={`${item.label ?? 'item'}-${index}`} item={item} />
            ))}
          </div>
        </section>
      );
    case 'table':
      return <TemplateTable presentation={section} />;
    case 'question_groups':
      return (
        <section style={{ minWidth: 0, maxWidth: '100%' }}>
          <SectionLabel>{section.title}</SectionLabel>
          <QuestionGroups groups={section.groups} />
        </section>
      );
  }
}

function TemplateTable({ presentation }: { presentation: Extract<BriefPresentation['sections'][number], { kind: 'table' }> }) {
  const minTableWidth = tableMinWidth(presentation.columns.length);
  return (
    <section style={{ minWidth: 0, maxWidth: '100%' }}>
      <SectionLabel>{presentation.title}</SectionLabel>
      <div className="gd-scroll" style={{
        overflowX: 'auto',
        maxWidth: '100%',
        minWidth: 0,
        border: `1px solid ${F.border}`,
        borderRadius: RADIUS.md,
      }}>
        <table style={{
          width: '100%',
          minWidth: minTableWidth,
          borderCollapse: 'collapse',
          fontFamily: 'var(--font-sans)',
          fontSize: TYPE.body.sm,
          tableLayout: 'fixed',
        }}>
          <thead>
            <tr>
              {presentation.columns.map((column) => (
                <th key={column} style={{
                  textAlign: 'left',
                  padding: `${SPACE.xs + 2}px ${SPACE.sm}px`,
                  background: F.cream50,
                  color: F.fgMuted,
                  fontFamily: 'var(--font-mono)',
                  fontSize: TYPE.meta.sm,
                  fontWeight: 700,
                  letterSpacing: TRACKING.micro,
                  textTransform: 'uppercase',
                  borderBottom: `1px solid ${F.border}`,
                  overflowWrap: 'break-word',
                }}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {presentation.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {presentation.columns.map((column, columnIndex) => (
                  <td key={`${rowIndex}-${column}`} style={{
                    padding: `${SPACE.xs + 2}px ${SPACE.sm}px`,
                    color: F.inkSoft,
                    borderBottom: rowIndex === presentation.rows.length - 1 ? 'none' : `1px solid ${F.border}`,
                    verticalAlign: 'top',
                    lineHeight: 1.4,
                    overflowWrap: 'break-word',
                  }}>
                    {formatCell(row[columnIndex])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {presentation.source_refs?.length ? (
        <div style={{ marginTop: SPACE.xs }}>{renderRefs(presentation.source_refs)}</div>
      ) : null}
    </section>
  );
}

function tableMinWidth(columnCount: number): number {
  if (columnCount >= 8) return 1040;
  if (columnCount >= 6) return 940;
  if (columnCount >= 5) return 820;
  return Math.min(560, columnCount * 140);
}

function BulletItem({ item }: { item: BriefPresentationBulletItem }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: item.label ? 'minmax(76px, 0.28fr) 1fr' : '1fr',
      gap: SPACE.sm,
      padding: `${SPACE.xs + 2}px 0`,
      borderBottom: `1px solid ${F.border}`,
      minWidth: 0,
    }}>
      {item.label && (
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: TYPE.meta.md,
          color: F.fenway,
          fontWeight: 700,
          letterSpacing: TRACKING.micro,
          textTransform: 'uppercase',
          overflowWrap: 'anywhere',
          minWidth: 0,
        }}>{item.label}</div>
      )}
      <div style={{
        fontFamily: 'var(--font-sans)',
        fontSize: TYPE.body.md,
        color: F.inkSoft,
        lineHeight: 1.5,
        minWidth: 0,
        overflowWrap: 'anywhere',
      }}>
        {renderWithCites(item.body)}
        {renderRefs(item.source_refs)}
      </div>
    </div>
  );
}

function QuestionGroups({ groups }: { groups: RecommendationNextQuestionGroup[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: SPACE.sm }}>
      {groups.map((group) => (
        <div key={group.audience} style={{
          border: `1px solid ${F.border}`,
          borderRadius: RADIUS.md,
          background: F.cream50,
          padding: SPACE.sm,
          minWidth: 0,
        }}>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: TYPE.meta.sm,
            fontWeight: 700,
            color: F.fenway,
            letterSpacing: TRACKING.micro,
            textTransform: 'uppercase',
            marginBottom: SPACE.xs,
            overflowWrap: 'anywhere',
          }}>{audienceLabel(group.audience)}</div>
          <ul style={{ margin: 0, paddingLeft: SPACE.lg, display: 'grid', gap: SPACE.xs }}>
            {group.questions.map((question, index) => (
              <li key={`${group.audience}-${index}`} style={{
                fontFamily: 'var(--font-sans)',
                fontSize: TYPE.body.sm,
                color: F.inkSoft,
                lineHeight: 1.45,
                overflowWrap: 'anywhere',
              }}>{question}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div style={{
      fontFamily: 'var(--font-sans)',
      fontSize: TYPE.meta.md,
      fontWeight: 700,
      color: F.fenway,
      letterSpacing: TRACKING.micro,
      textTransform: 'uppercase',
      marginBottom: SPACE.sm,
    }}>{children}</div>
  );
}

function renderWithCites(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\[(\d+)\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(<span key={`t${key++}`}>{text.slice(last, m.index)}</span>);
    out.push(<Cite key={`c${key++}`} n={Number(m[1])} />);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(<span key={`t${key++}`}>{text.slice(last)}</span>);
  return out;
}

function renderRefs(refs?: number[]) {
  if (!refs?.length) return null;
  return (
    <span style={{ display: 'inline-flex', gap: 3, marginLeft: SPACE.xs, verticalAlign: 'middle' }}>
      {refs.map((ref) => <Cite key={ref} n={ref} />)}
    </span>
  );
}

function formatCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return 'N/A';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
  return value;
}

function audienceLabel(audience: string): string {
  const labels: Record<string, string> = {
    analytics: 'Analytics',
    coaching: 'Coaching',
    scouting_front_office: 'Scouting / Front office',
    cap_contracts: 'Cap / Contracts',
    gambit: 'Gambit follow-up',
  };
  return labels[audience] ?? audience.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}
