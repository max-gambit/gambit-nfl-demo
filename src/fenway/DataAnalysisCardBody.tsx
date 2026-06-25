import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';
import { Cite } from '../ds/Cite';
import type { DataAnalysisBriefBody } from '@shared/types';

interface Props {
  body: DataAnalysisBriefBody;
}

export function DataAnalysisCardBody({ body }: Props) {
  return (
    <div style={{ display: 'grid', gap: SPACE.lg }}>
      {body.key_findings.length > 0 && (
        <section>
          <SectionLabel>Key findings</SectionLabel>
          <div style={{ display: 'grid', gap: SPACE.sm }}>
            {body.key_findings.map((finding, index) => (
              <div key={`${finding.label}-${index}`} style={{ display: 'grid', gap: 3 }}>
                <div style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: TYPE.body.md,
                  fontWeight: 700,
                  color: F.ink,
                }}>
                  {finding.label} {renderRefs(finding.source_refs)}
                </div>
                <div style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: TYPE.body.md,
                  lineHeight: 1.55,
                  color: F.inkSoft,
                }}>{finding.body}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {body.tables.map((table, index) => (
        <section key={`${table.title}-${index}`}>
          <SectionLabel>{table.title}</SectionLabel>
          <div style={{ overflowX: 'auto', border: `1px solid ${F.border}`, borderRadius: RADIUS.md }}>
            <table style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontFamily: 'var(--font-sans)',
              fontSize: TYPE.body.sm,
            }}>
              <thead>
                <tr>
                  {table.columns.map((column) => (
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
                    }}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {table.columns.map((column, columnIndex) => (
                      <td key={`${rowIndex}-${column}`} style={{
                        padding: `${SPACE.xs + 2}px ${SPACE.sm}px`,
                        color: F.inkSoft,
                        borderBottom: rowIndex === table.rows.length - 1 ? 'none' : `1px solid ${F.border}`,
                        fontVariantNumeric: 'tabular-nums',
                      }}>
                        {formatCell(row[columnIndex])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: SPACE.xs }}>{renderRefs(table.source_refs)}</div>
        </section>
      ))}

      {body.calculations.length > 0 && (
        <section>
          <SectionLabel>Calculations</SectionLabel>
          <div style={{ display: 'grid', gap: SPACE.xs }}>
            {body.calculations.map((calculation, index) => (
              <div key={`${calculation.label}-${index}`} style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(120px, 0.45fr) 1fr',
                gap: SPACE.sm,
                alignItems: 'baseline',
              }}>
                <div style={{ fontFamily: 'var(--font-sans)', fontSize: TYPE.body.sm, fontWeight: 700, color: F.ink }}>
                  {calculation.label}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.md, color: F.inkSoft, lineHeight: 1.5 }}>
                  {calculation.formula ? `${calculation.formula} = ` : ''}{calculation.value} {renderRefs(calculation.source_refs)}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {body.caveats.length > 0 && (
        <section>
          <SectionLabel>Caveats</SectionLabel>
          <div style={{
            display: 'grid',
            gap: SPACE.xs,
            padding: SPACE.md,
            background: F.cream50,
            border: `1px solid ${F.border}`,
            borderRadius: RADIUS.md,
          }}>
            {body.caveats.map((caveat, index) => (
              <div key={index} style={{
                fontFamily: 'var(--font-sans)',
                fontSize: TYPE.body.sm,
                lineHeight: 1.5,
                color: F.fgMuted,
              }}>{caveat}</div>
            ))}
          </div>
        </section>
      )}

      {body.followups.length > 0 && (
        <section>
          <SectionLabel>Next questions</SectionLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.xs }}>
            {body.followups.map((followup, index) => (
              <span key={index} style={{
                fontFamily: 'var(--font-sans)',
                fontSize: TYPE.body.sm,
                color: F.fenway,
                background: F.fenwaySoft,
                border: `1px solid ${F.fenway}`,
                borderRadius: RADIUS.pill,
                padding: `${SPACE.xs - 1}px ${SPACE.sm}px`,
              }}>{followup}</span>
            ))}
          </div>
        </section>
      )}
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

function renderRefs(refs: number[]) {
  return refs.map((ref) => <Cite key={ref} n={ref} />);
}

function formatCell(value: string | number | null): string {
  if (value === null) return 'N/A';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
  return value;
}
