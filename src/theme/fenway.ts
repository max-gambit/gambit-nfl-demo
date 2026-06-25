// V6D3CF Warriors palette — the canonical production palette.
// Ported from v6d3c-fenway.jsx:30-58.

export const F = {
  paper: '#F7F9FC',
  surface: '#FFFFFF',
  cream50: '#EEF3FA',
  cream100: '#D8E2EF',
  ink: '#1B1A17',
  inkSoft: '#3A3833',
  fg: '#5A574F',
  fgMuted: '#8E8B82',
  fgFaint: '#B8B4A8',
  border: '#D8E2EF',
  borderStrong: '#B6C7DC',
  // Accent (= Warriors royal blue) - nav, structure, links, focus, active states only
  accent: '#1D428A',
  accentSoft: '#E8F0FB',
  fenway: '#1D428A',
  fenwaySoft: '#E8F0FB',
  // Positive (= Warriors gold) — good cap delta in DATA only
  positive: '#B88200',
  positiveSoft: '#FFF3CC',
  red: '#B8392E',
  redSoft: '#F8E8E4',
  amber: '#C68A1A',
  amberSoft: '#F2E6CC',
  shadow: '0 1px 2px rgba(60,40,10,0.04), 0 4px 14px rgba(60,40,10,0.05)',
  shadowSoft: '0 1px 1px rgba(60,40,10,0.04)',
  shadowChat: '0 1px 2px rgba(60,40,10,0.05), 0 8px 24px rgba(60,40,10,0.07)',
  // Phase 10 — single canonical popover/floating-panel shadow. Replaces
  // ad-hoc inline `0 12px 32px rgba(20, 16, 8, 0.14), 0 1px 3px rgba(20, 16, 8, 0.05)`
  // shadows scattered through Header / MonitorsPanel / Composer slash menu /
  // Cite popover. Tone-matched to the warm-cream palette.
  shadowPop: '0 12px 32px rgba(60,40,10,0.10), 0 1px 3px rgba(60,40,10,0.04)',
} as const;

// ── Phase 10 design tokens ────────────────────────────────────────────────
//
// These replace the inline numeric literals scattered across components.
// Anything that doesn't fit one of these values should be pulled toward the
// nearest member rather than added to the set.

/** 4-pixel grid. */
export const SPACE = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
} as const;

/** Border radius. `pill` is for fully-rounded chips/badges. */
export const RADIUS = {
  sm: 4,
  md: 8,
  lg: 12,
  pill: 999,
} as const;

/** Type scale — capped at 7 sizes (display 22/18/15, body 14/13/12, meta 11/10/9).
 *  Mono uses the same numbers as sans; weight + family carry the difference. */
export const TYPE = {
  display: { lg: 22, md: 18, sm: 15 },
  body:    { lg: 14, md: 13, sm: 12 },
  meta:    { md: 11, sm: 10, xs: 9 },
} as const;

/** Letter-spacing tiers, each with one job. */
export const TRACKING = {
  /** Display headings only. */
  tight: '-0.01em',
  /** Default — sans-body, anything not in the other tiers. */
  body: '0',
  /** Small-caps eyebrows + mono meta labels. */
  caps: '0.04em',
  /** 9–10px ALL-CAPS section heads + badges. */
  micro: '0.08em',
} as const;
