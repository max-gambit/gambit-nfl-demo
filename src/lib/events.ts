// Decoupled event bus — used to coordinate keyboard handlers in FenwayApp
// with subscribing components (BriefTabs, composer, palette, help overlay)
// without prop-drilling.

export type GambitEventMap = {
  'v6d3cf:goto-brief': { index: number };
  'v6d3cf:cycle-brief': { dir: 'prev' | 'next' };
  'v6d3cf:last-brief': void;
  'v6d3cf:focus-composer': void;
  /** ⌘B — focuses the brief-thread reply composer in the right panel. */
  'v6d3cf:focus-reply-composer': void;
  'v6d3cf:open-palette': void;
  'v6d3cf:toggle-help': void;
  /** Submit `text` through the chat composer as if the user typed and pressed Enter. */
  'v6d3cf:submit-chat': { text: string };
  /** Submit `text` as a new data analyst brief in the active channel. */
  'v6d3cf:submit-data-brief': { text: string };
  /** Prefill the main Analyze composer without submitting. */
  'v6d3cf:prefill-composer': { text: string };
  /** Prefill the right-panel brief reply composer without submitting. */
  'v6d3cf:prefill-reply-composer': { text: string };
  /** Cite chip hover: ref is the source ref_index (or null on leave). LeftRail subscribes to glow the matching card. */
  'v6d3cf:cite-hover': { ref: number | null };
  /** Slash-command shortcut: regenerate the active brief. BriefActions listens. */
  'v6d3cf:slash-regenerate': void;
};

export function fire<K extends keyof GambitEventMap>(
  name: K,
  detail?: GambitEventMap[K],
) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

export function on<K extends keyof GambitEventMap>(
  name: K,
  handler: (detail: GambitEventMap[K]) => void,
) {
  const wrapped = (e: Event) => handler((e as CustomEvent).detail);
  window.addEventListener(name, wrapped);
  return () => window.removeEventListener(name, wrapped);
}
