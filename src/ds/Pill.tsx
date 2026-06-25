import type { CSSProperties } from 'react';
import type { PillKind } from '@shared/types';

const PILL_STYLES: Record<PillKind, CSSProperties & { borderStyle?: string }> = {
  executable:  { color: '#2D6A4F', borderColor: '#2D6A4F', background: '#EAF2EC' },
  speculative: { color: '#B5781A', borderColor: '#B5781A', background: '#FBF1DE' },
  plausible:   { color: '#777C87', borderColor: '#BFC2C9', background: 'transparent', borderStyle: 'dashed' },
  negative:    { color: '#B8392E', borderColor: '#B8392E', background: '#F8E5E1' },
  compete:     { color: 'var(--seasoned-700)', borderColor: 'var(--seasoned-500)', background: 'var(--seasoned-50)' },
  transition:  { color: 'var(--ink-900)', borderColor: 'var(--ink-900)', background: 'transparent' },
  swing:       { color: 'var(--ink-700)', borderColor: 'var(--ink-300)', background: 'transparent' },
  trade:       { color: 'var(--ink-700)', borderColor: 'var(--ink-300)', background: 'transparent' },
  fa:          { color: 'var(--seasoned-700)', borderColor: 'var(--seasoned-300)', background: 'var(--seasoned-50)' },
  extension:   { color: 'var(--fenway-600)', borderColor: 'var(--fenway-300)', background: 'var(--fenway-50)' },
};

interface PillProps {
  kind?: PillKind;
  size?: 'sm' | 'md';
  radius?: number;
  children: React.ReactNode;
}

export function Pill({ kind = 'plausible', children, size = 'md', radius = 0 }: PillProps) {
  const s = PILL_STYLES[kind] || PILL_STYLES.plausible;
  const h = size === 'sm' ? 18 : 20;
  const fs = size === 'sm' ? 9 : 10;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: h,
        padding: '0 8px',
        fontSize: fs,
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        fontFamily: 'var(--font-mono)',
        border: '1px solid',
        borderStyle: s.borderStyle || 'solid',
        color: s.color as string,
        borderColor: s.borderColor as string,
        background: s.background as string,
        borderRadius: radius,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}
