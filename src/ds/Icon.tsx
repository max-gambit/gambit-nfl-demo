// Icon set used across V8 components — ported from V8Icon in v8-agents.jsx.

interface IconProps {
  name: string;
  size?: number;
  color?: string;
}

export function Icon({ name, size = 14, color = 'currentColor' }: IconProps) {
  const props = {
    width: size,
    height: size,
    fill: 'none' as const,
    stroke: color,
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (name) {
    case 'deck':
      return <svg viewBox="0 0 24 24" {...props}><rect x="3" y="5" width="18" height="13" rx="1.5" /><path d="M3 10h18" /><path d="M7 14h6" /></svg>;
    case 'doc':
      return <svg viewBox="0 0 24 24" {...props}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></svg>;
    case 'clipboard':
      return <svg viewBox="0 0 24 24" {...props}><path d="M9 4h6a2 2 0 0 1 2 2v1H7V6a2 2 0 0 1 2-2Z" /><path d="M8 6H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-2" /><path d="M8 12h8M8 16h5" /></svg>;
    case 'search':
      return <svg viewBox="0 0 24 24" {...props}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>;
    case 'grid':
      return <svg viewBox="0 0 24 24" {...props}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>;
    case 'merge':
      return <svg viewBox="0 0 24 24" {...props}><path d="M6 4v6a4 4 0 0 0 4 4h8" /><path d="M18 4v6a4 4 0 0 1-4 4H6" /><path d="m15 11 3 3-3 3" /></svg>;
    case 'eye':
      return <svg viewBox="0 0 24 24" {...props}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>;
    case 'refresh':
      return <svg viewBox="0 0 24 24" {...props}><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 21v-5h5" /></svg>;
    case 'pulse':
      return <svg viewBox="0 0 24 24" {...props}><path d="M3 12h4l3-8 4 16 3-8h4" /></svg>;
    case 'shield':
      return <svg viewBox="0 0 24 24" {...props}><path d="M12 3 4 6v6c0 5 3.5 8.5 8 9 4.5-.5 8-4 8-9V6Z" /></svg>;
    case 'plus':
      return <svg viewBox="0 0 24 24" {...props}><path d="M12 5v14M5 12h14" /></svg>;
    case 'pause':
      return <svg viewBox="0 0 24 24" {...props}><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>;
    case 'play':
      return <svg viewBox="0 0 24 24" {...props}><path d="M6 4v16l14-8z" /></svg>;
    case 'edit':
      return <svg viewBox="0 0 24 24" {...props}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" /></svg>;
    case 'trash':
      return <svg viewBox="0 0 24 24" {...props}><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" /></svg>;
    case 'archive':
      return <svg viewBox="0 0 24 24" {...props}><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" /><path d="M10 12h4" /></svg>;
    case 'more-horizontal':
      return <svg viewBox="0 0 24 24" {...props}><circle cx="5" cy="12" r="1.5" fill={color} stroke="none" /><circle cx="12" cy="12" r="1.5" fill={color} stroke="none" /><circle cx="19" cy="12" r="1.5" fill={color} stroke="none" /></svg>;
    case 'spark':
      return <svg viewBox="0 0 24 24" {...props}><path d="M12 2v4M12 18v4M5 12H1M23 12h-4M19 5l-3 3M8 16l-3 3M5 5l3 3M16 16l3 3" /></svg>;
    case 'check':
      return <svg viewBox="0 0 24 24" {...props}><path d="m4 12 5 5 11-11" /></svg>;
    case 'bell':
      return <svg viewBox="0 0 24 24" {...props}><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8" /><path d="M10 21a2 2 0 0 0 4 0" /></svg>;
    case 'share':
      return <svg viewBox="0 0 24 24" {...props}><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="m8.6 10.6 6.8-4.2M8.6 13.4l6.8 4.2" /></svg>;
    case 'link':
      return <svg viewBox="0 0 24 24" {...props}><path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1" /><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1" /></svg>;
    case 'user-plus':
      return <svg viewBox="0 0 24 24" {...props}><path d="M15 21a6 6 0 0 0-12 0" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M16 11h6" /></svg>;
    case 'file-down':
      return <svg viewBox="0 0 24 24" {...props}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M12 12v5" /><path d="m9 15 3 3 3-3" /></svg>;
    default:
      return null;
  }
}
