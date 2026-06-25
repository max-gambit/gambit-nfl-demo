import { useEffect, useState } from 'react';
import { F } from '../theme/fenway';
import { ContextGraphTrustStrip } from './ContextGraphTrustStrip';
import { DataAnalystTrustStrip } from './DataAnalystTrustStrip';
import { MarkdownReplyBody } from './MarkdownReplyBody';
import type { ToolCall } from '@shared/types';

export function UserTurnView({ content, ts }: { content: string; ts: Date }) {
  return (
    <div style={{ marginTop: 22, marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{ maxWidth: '70%', display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: F.fgFaint, marginBottom: 3, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              You · {ts.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </div>
            <div style={{ fontFamily: 'var(--font-sans)', fontSize: 14, lineHeight: 1.55, color: F.ink, fontWeight: 500 }}>
              {content}
            </div>
          </div>
          <div style={{ width: 2, alignSelf: 'stretch', background: F.border, borderRadius: 1, marginTop: 16 }} />
        </div>
      </div>
    </div>
  );
}

export function AssistantTurnView({
  content,
  streaming,
  toolCalls,
  label = 'analyst',
}: {
  content: string;
  streaming: boolean;
  toolCalls?: ToolCall[] | null;
  label?: string;
}) {
  return (
    <div style={{ marginBottom: 4 }}>
      <div style={{
        background: F.surface, border: `1px solid ${F.border}`,
        borderRadius: 12, padding: '18px 26px', boxShadow: F.shadowChat,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div style={{
            width: 24, height: 24, background: F.ink, color: F.accent,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700,
            borderRadius: 999,
          }}>G</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: F.fgMuted }}>
            {streaming ? 'streaming…' : label}
          </div>
        </div>
        <MarkdownReplyBody content={content} streaming={streaming} />
        <ContextGraphTrustStrip toolCalls={toolCalls} />
        <DataAnalystTrustStrip toolCalls={toolCalls} />
      </div>
    </div>
  );
}

export function ThinkingIndicator() {
  const [dots, setDots] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setDots((d) => (d + 1) % 4), 400);
    return () => clearInterval(i);
  }, []);
  return (
    <div style={{
      marginTop: 4, marginBottom: 4,
      background: F.surface, border: `1px solid ${F.border}`,
      borderRadius: 12, padding: '14px 26px', boxShadow: F.shadowChat,
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{
        width: 24, height: 24, background: F.ink, color: F.accent,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'var(--font-display)', fontSize: 11, fontWeight: 700,
        borderRadius: 999, flexShrink: 0,
      }}>G</div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: F.fgMuted, letterSpacing: '0.02em' }}>
        Thinking{'.'.repeat(dots)}
      </div>
      <div style={{ flex: 1, height: 1, background: F.border, position: 'relative', overflow: 'hidden' }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0, width: '30%',
          background: F.fenway,
          animation: 'thinking-slide 1.2s ease-in-out infinite',
        }} />
      </div>
    </div>
  );
}
