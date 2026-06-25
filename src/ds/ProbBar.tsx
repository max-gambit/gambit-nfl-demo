import { F } from '../theme/fenway';

interface ProbBarProps {
  pct: number;
  color?: string;
  track?: string;
  width?: number;
  height?: number;
}

export function ProbBar({
  pct,
  color = F.accent,
  track = F.cream100,
  width = 56,
  height = 4,
}: ProbBarProps) {
  return (
    <div style={{ width, height, background: track, position: 'relative', borderRadius: height / 2, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: `${pct}%`, background: color, borderRadius: height / 2 }} />
    </div>
  );
}
