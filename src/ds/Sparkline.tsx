import { F } from '../theme/fenway';

interface SparkProps {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  withDot?: boolean;
}

export function Sparkline({
  data,
  width = 70,
  height = 20,
  stroke = F.positive,
  fill = 'rgba(30,90,140,0.07)',
  withDot = true,
}: SparkProps) {
  if (!data || !data.length) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const stepX = data.length > 1 ? width / (data.length - 1) : 0;
  const pts = data.map((v, i) => [i * stepX, height - ((v - min) / range) * height] as [number, number]);
  const d = pts.map((p, i) => (i === 0 ? `M ${p[0]},${p[1]}` : `L ${p[0]},${p[1]}`)).join(' ');
  const fillD = `${d} L ${width},${height} L 0,${height} Z`;
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      {fill && <path d={fillD} fill={fill} />}
      <path d={d} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {withDot && <circle cx={last[0]} cy={last[1]} r="2" fill={stroke} />}
    </svg>
  );
}
