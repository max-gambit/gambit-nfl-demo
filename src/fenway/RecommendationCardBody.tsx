import type { ReactNode } from 'react';
import { F } from '../theme/fenway';
import { Cite } from '../ds/Cite';
import type { RecommendationBriefBody } from '@shared/types';

// Splits a paragraph on `[N]` citation markers and renders each one as a
// `<Cite>` chip inline. Defensive against malformed markers — anything that
// doesn't parse as an integer is left as plain text.
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

interface Props {
  body: RecommendationBriefBody;
}

export function RecommendationCardBody({ body }: Props) {
  // Reasoning may include double-newline-separated paragraphs; render each as
  // its own <p> so spacing matches the wireframe.
  const paragraphs = body.reasoning.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const nextQuestions = (body.next_questions ?? [])
    .map((group) => ({ ...group, questions: group.questions.filter((question) => question.trim().length > 0) }))
    .filter((group) => group.questions.length > 0);

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <div style={{
          fontFamily: 'var(--font-sans)', fontSize: 10.5, fontWeight: 600,
          color: F.fgMuted, letterSpacing: '0.08em', textTransform: 'uppercase',
          marginBottom: 8,
        }}>
          Why
        </div>

        {paragraphs.map((p, i) => (
          <p key={i} style={{ marginTop: 0, marginBottom: i === paragraphs.length - 1 && !body.blockquote ? 0 : 10 }}>
            {renderWithCites(p)}
          </p>
        ))}

        {body.blockquote && (
          <blockquote style={{
            margin: '10px 0', padding: '10px 14px',
            borderLeft: `3px solid ${F.fenway}`,
            background: F.cream50,
            fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.55, color: F.ink,
            fontStyle: 'normal',
          }}>
            "{body.blockquote.text}"
            <div style={{
              marginTop: 6, fontFamily: 'var(--font-sans)', fontSize: 10.5,
              color: F.fgMuted, fontWeight: 500, letterSpacing: '0.02em',
            }}>
              {body.blockquote.source}
              {typeof body.blockquote.cite_ref === 'number' && <Cite n={body.blockquote.cite_ref} />}
            </div>
          </blockquote>
        )}
      </div>

      {body.watching.length > 0 && (
        <details style={{ marginTop: 4 }}>
          <summary style={{
            fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600,
            color: F.fgMuted, letterSpacing: '0.06em', textTransform: 'uppercase',
            cursor: 'pointer', listStyle: 'none', userSelect: 'none',
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 0',
          }}>
            <span aria-hidden="true" style={{
              fontFamily: 'var(--font-mono)', fontSize: 10, color: F.fgFaint,
              transition: 'transform 0.15s ease',
            }}>▸</span>
            Risks & what to watch
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 500,
              color: F.fgFaint, letterSpacing: '0.04em',
            }}>· {body.watching.length}</span>
          </summary>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 7, marginTop: 10, paddingLeft: 16 }}>
            {body.watching.map((w, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
                  color: F.fenway, letterSpacing: '0.04em', textTransform: 'uppercase',
                  minWidth: 52, flexShrink: 0,
                }}>{w.tag}</span>
                <span style={{ fontSize: 13, color: F.inkSoft, lineHeight: 1.55 }}>{w.body}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {nextQuestions.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary style={{
            fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600,
            color: F.fgMuted, letterSpacing: '0.06em', textTransform: 'uppercase',
            cursor: 'pointer', listStyle: 'none', userSelect: 'none',
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 0',
          }}>
            <span aria-hidden="true" style={{
              fontFamily: 'var(--font-mono)', fontSize: 10, color: F.fgFaint,
            }}>▸</span>
            Staff follow-up questions
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 9.5, fontWeight: 500,
              color: F.fgFaint, letterSpacing: '0.04em',
            }}>· {nextQuestions.reduce((sum, group) => sum + group.questions.length, 0)}</span>
          </summary>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginTop: 10, paddingLeft: 16 }}>
            {nextQuestions.map((group) => (
              <div
                key={group.audience}
                style={{
                  border: `1px solid ${F.border}`,
                  borderRadius: 8,
                  background: F.surface,
                  padding: 10,
                  minWidth: 0,
                }}
              >
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  fontWeight: 700,
                  color: F.fenway,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  marginBottom: 6,
                  overflowWrap: 'anywhere',
                }}>
                  {audienceLabel(group.audience)}
                </div>
                <ul style={{ margin: 0, paddingLeft: 16, display: 'grid', gap: 6 }}>
                  {group.questions.map((question, index) => (
                    <li key={`${group.audience}-${index}`} style={{ fontSize: 12.5, color: F.inkSoft, lineHeight: 1.45, overflowWrap: 'anywhere' }}>
                      {question}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
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
