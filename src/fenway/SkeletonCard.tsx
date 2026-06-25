import { F } from '../theme/fenway';

/**
 * Placeholder card shown while switching briefs and the new brief's data
 * (turns / sources / options) hasn't landed yet. Mirrors the recommendation
 * card's structure with cream100 shimmer blocks. Disappears within ~200ms
 * on a warm cache.
 */
export function SkeletonCard() {
  return (
    <div style={{
      background: F.surface, border: `1px solid ${F.border}`,
      borderRadius: 12, padding: '22px 26px', marginBottom: 18,
      boxShadow: F.shadowChat,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <Block w={28} h={28} radius={999} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <Block w={120} h={11} />
          <Block w={80} h={9} />
        </div>
      </div>
      <Block w={88} h={10} radius={3} />
      <div style={{ height: 8 }} />
      <Block w={'82%'} h={20} radius={6} />
      <div style={{ height: 16 }} />
      <Block w={'94%'} h={11} />
      <div style={{ height: 6 }} />
      <Block w={'88%'} h={11} />
      <div style={{ height: 6 }} />
      <Block w={'70%'} h={11} />
      <div style={{ height: 18 }} />
      <Block w={108} h={10} radius={3} />
      <div style={{ height: 8 }} />
      <Block w={'90%'} h={10} />
      <div style={{ height: 5 }} />
      <Block w={'76%'} h={10} />
    </div>
  );
}

function Block({ w, h, radius = 4 }: { w: number | string; h: number; radius?: number }) {
  return (
    <div style={{
      width: typeof w === 'number' ? `${w}px` : w,
      height: h,
      background: F.cream100,
      borderRadius: radius,
      animation: 'skeleton-shimmer 1.6s ease-in-out infinite',
    }} />
  );
}
