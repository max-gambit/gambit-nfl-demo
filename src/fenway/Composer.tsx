import { useEffect, useRef, useState } from 'react';
import { F, RADIUS, SPACE, TRACKING, TYPE } from '../theme/fenway';
import { fire, on as onEvt } from '../lib/events';
import type { AgentKind } from '@shared/types';

// Composer max height in pixels — caps the textarea growth at ~6 lines before
// scrolling kicks in. Keeps the composer from eating the screen on long input.
const COMPOSER_MAX_HEIGHT = 160;
// Min height matches a single-line input — below this the textarea snaps shut.
const COMPOSER_MIN_HEIGHT = 22;

interface SlashCommand {
  cmd: string;
  label: string;
  hint: string;
  /** Either a callback (synchronous side effect) or an agent kind to dispatch. */
  run: () => void;
  insertText?: string;
}

export interface ComposerProps {
  onSubmit: (text: string) => void;
  onValueChange?: (text: string) => void;
  disabled?: boolean;
  /** Dispatch an agent — used by the slash menu. Same shape as the in-card buttons. */
  onSlashCommand?: (kind: AgentKind, label: string) => void;
  /** Placeholder text override — defaults to "Ask a follow-up…". */
  placeholder?: string;
  /** Which keyboard-shortcut event to subscribe to:
   *   - 'main'  → `v6d3cf:focus-composer`        (⌘J — channel-level composer)
   *   - 'reply' → `v6d3cf:focus-reply-composer`  (⌘B — brief-thread reply composer)
   *   - null    → no global binding (component is focused by its own affordances only)
   *  Only one composer per binding should be mounted at a time. */
  focusBinding?: 'main' | 'reply' | null;
  /** Optional brief-scoped callback for `/regenerate`. When set,
   *  the slash command runs the callback instead of firing the global event —
   *  used by per-brief composers (channel feed) where BriefActions isn't
   *  rendered to catch the global event. */
  onRegenerate?: () => void;
  /** When true, focus the textarea on first mount. Used by surfaces where
   *  the composer is the next-action target (e.g. opening a brief thread). */
  autoFocus?: boolean;
}

/**
 * Phase 8 — extracted from the old Chat.tsx. A single textarea-based composer
 * with auto-resize, slash-command menu, and ⌘J focus. Used by:
 *   - SessionFeed (per-channel new-brief composer at bottom)
 *   - BriefThreadStrip (per-brief reply composer)
 *   - BriefFocusView (focused-brief reply composer)
 */
export function Composer({
  onSubmit, onValueChange, disabled, onSlashCommand,
  placeholder = 'Ask a follow-up…',
  focusBinding = null,
  onRegenerate,
  autoFocus = false,
}: ComposerProps) {
  const [focused, setFocused] = useState(false);
  const [value, setValue] = useState('');
  const [slashIdx, setSlashIdx] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!focusBinding) return;
    const eventName = focusBinding === 'main' ? 'v6d3cf:focus-composer' : 'v6d3cf:focus-reply-composer';
    return onEvt(eventName, () => taRef.current?.focus());
  }, [focusBinding]);

  useEffect(() => {
    if (focusBinding !== 'main') return;
    return onEvt('v6d3cf:prefill-composer', ({ text }) => {
      setValue(text);
      setSlashIdx(0);
      requestAnimationFrame(() => taRef.current?.focus());
    });
  }, [focusBinding]);

  useEffect(() => {
    if (focusBinding !== 'reply') return;
    return onEvt('v6d3cf:prefill-reply-composer', ({ text }) => {
      setValue(text);
      setSlashIdx(0);
      requestAnimationFrame(() => taRef.current?.focus());
    });
  }, [focusBinding]);

  // Focus the textarea on first mount when the parent opts in. Runs once.
  // The 0ms timeout defers focus until after the render commits — without
  // it the textarea ref isn't yet attached on the very first paint.
  useEffect(() => {
    if (!autoFocus) return;
    const t = setTimeout(() => taRef.current?.focus(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Slash-command catalog. Filtered by what the user types after `/`. The
  // commands here cover the most common in-flow ops — agents and regeneration
  // without leaving the keyboard.
  const allCommands: SlashCommand[] = [
    { cmd: '/data',        label: 'Ask data analyst',  hint: 'Tables + source caveats',     run: () => {}, insertText: '/data ' },
    { cmd: '/deck',        label: 'Generate deck',     hint: 'PPTX-shaped outline',         run: () => onSlashCommand?.('deck', 'Deck') },
    { cmd: '/memo',        label: 'Draft memo',        hint: 'Long-form prose',             run: () => onSlashCommand?.('memo', 'Memo') },
    { cmd: '/research',    label: 'Run deeper research', hint: 'Multi-source synthesis',     run: () => onSlashCommand?.('research', 'Research') },
    { cmd: '/staff',       label: 'Create staff packet', hint: 'Forwardable protocol',       run: () => onSlashCommand?.('staff_protocol', 'Staff protocol') },
    { cmd: '/comps',       label: 'Find comps',        hint: 'Comparable players',          run: () => onSlashCommand?.('comp_set', 'Comps') },
    { cmd: '/regenerate',  label: 'Regenerate brief',  hint: 'Re-run the analyst',          run: () => onRegenerate ? onRegenerate() : fire('v6d3cf:slash-regenerate') },
  ];

  const trimmed = value.trim();
  const isSlashing = value.startsWith('/') && !value.includes(' ') && !value.includes('\n');
  const slashFilter = isSlashing ? value.toLowerCase() : '';
  const matchedCommands = isSlashing
    ? allCommands.filter((c) => c.cmd.toLowerCase().startsWith(slashFilter))
    : [];
  const showSlash = focused && matchedCommands.length > 0;

  // Reset selection whenever the menu shape changes.
  useEffect(() => {
    setSlashIdx((cur) => Math.min(cur, Math.max(0, matchedCommands.length - 1)));
  }, [matchedCommands.length]);

  // Auto-resize: measure scrollHeight after each value change, clamp to range.
  // Resetting height to 'auto' first is required so scrollHeight reflects the
  // actual content size rather than the previous render's expanded size.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const next = Math.min(COMPOSER_MAX_HEIGHT, Math.max(COMPOSER_MIN_HEIGHT, ta.scrollHeight));
    ta.style.height = `${next}px`;
  }, [value]);

  useEffect(() => {
    onValueChange?.(value);
  }, [onValueChange, value]);

  const runSlashCommand = (cmd: SlashCommand) => {
    if (cmd.insertText) {
      setValue(cmd.insertText);
      setSlashIdx(0);
      requestAnimationFrame(() => taRef.current?.focus());
      return;
    }
    cmd.run();
    setValue('');
    setSlashIdx(0);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Slash menu navigation takes precedence when active.
    if (showSlash) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIdx((cur) => Math.min(matchedCommands.length - 1, cur + 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIdx((cur) => Math.max(0, cur - 1));
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const target = matchedCommands[slashIdx];
        if (target) setValue(target.cmd + ' ');
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const target = matchedCommands[slashIdx];
        if (target) runSlashCommand(target);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setValue('');
        return;
      }
    }
    // Enter submits; Shift+Enter inserts a newline.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && value.trim()) {
        onSubmit(value);
        setValue('');
      }
    }
  };

  const showStaticCursor = !focused && !value;
  const showBlinkingCursor = focused && !value;
  const chevronPulses = !focused;
  const isExpanded = focused || !!value;

  return (
    <div style={{
      background: F.cream50, border: `1px solid ${isExpanded ? F.borderStrong : F.border}`,
      borderRadius: RADIUS.lg,
      padding: isExpanded
        ? `${SPACE.sm}px ${SPACE.lg}px`
        : `${SPACE.xs}px ${SPACE.lg}px`,
      boxShadow: F.shadowChat,
      transition: 'padding 0.15s ease, border-color 0.15s ease',
      position: 'relative',
    }}>
      {showSlash && (
        <div style={{
          position: 'absolute', left: 0, right: 0, bottom: 'calc(100% + 6px)',
          background: F.surface,
          border: `1px solid ${F.borderStrong}`, borderRadius: RADIUS.md,
          boxShadow: F.shadowPop,
          padding: `${SPACE.xs}px 0`, zIndex: 50,
          maxHeight: 280, overflowY: 'auto',
        }}>
          <div style={{
            padding: `${SPACE.xs + 2}px ${SPACE.md}px`,
            fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.xs, fontWeight: 700,
            color: F.fgMuted, letterSpacing: '0.08em', textTransform: 'uppercase',
            borderBottom: `1px solid ${F.border}`,
          }}>Slash commands</div>
          {matchedCommands.map((c, i) => {
            const selected = i === slashIdx;
            return (
              <button key={c.cmd} onClick={() => runSlashCommand(c)}
                onMouseEnter={() => setSlashIdx(i)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: SPACE.md,
                  padding: `${SPACE.sm}px ${SPACE.md}px`,
                  background: selected ? F.cream50 : 'transparent',
                  border: 'none',
                  borderLeft: selected ? `2px solid ${F.fenway}` : '2px solid transparent',
                  cursor: 'pointer', textAlign: 'left',
                }}>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: TYPE.body.sm, fontWeight: 600,
                  color: F.fenway, minWidth: 90,
                }}>{c.cmd}</span>
                <span style={{
                  fontFamily: 'var(--font-sans)', fontSize: TYPE.body.sm, color: F.ink, fontWeight: 500,
                  flex: 1,
                }}>{c.label}</span>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.sm, color: F.fgMuted,
                }}>{c.hint}</span>
              </button>
            );
          })}
          <div style={{
            padding: `${SPACE.xs + 2}px ${SPACE.md}px`, borderTop: `1px solid ${F.border}`,
            fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.xs, color: F.fgFaint,
            display: 'flex', gap: SPACE.md,
          }}>
            <span><span style={{ color: F.fenway }}>↑↓</span> navigate</span>
            <span><span style={{ color: F.fenway }}>↵</span> run</span>
            <span><span style={{ color: F.fenway }}>tab</span> autocomplete</span>
          </div>
        </div>
      )}
      <div style={{
        display: 'flex', alignItems: 'flex-start', gap: SPACE.md,
        opacity: disabled ? 0.55 : 1,
      }}
        onClick={() => taRef.current?.focus()}>
        <button title="Attach (or type /attach)" style={{
          flexShrink: 0, padding: 0, background: 'transparent', border: 'none',
          color: F.fgFaint, cursor: 'pointer',
          fontFamily: 'var(--font-mono)', fontSize: TYPE.body.lg, lineHeight: '22px', fontWeight: 400,
          width: 14, textAlign: 'center',
        }}>+</button>
        <span aria-hidden="true" style={{
          fontFamily: 'var(--font-mono)', fontSize: TYPE.body.md, fontWeight: 500,
          color: F.fenway, letterSpacing: '0.02em', flexShrink: 0,
          lineHeight: '22px',
          animation: chevronPulses ? 'chevron-pulse 1.8s ease-in-out infinite' : 'none',
        }}>›</span>
        <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'flex-start', minHeight: COMPOSER_MIN_HEIGHT }}>
          <textarea
            ref={taRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKey}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            disabled={disabled}
            rows={1}
            placeholder=""
            style={{
              flex: 1, width: '100%', border: 'none', outline: 'none', background: 'transparent',
              fontSize: TYPE.body.lg, lineHeight: '22px', color: F.ink,
              fontFamily: 'var(--font-mono)', padding: 0,
              resize: 'none', overflowY: 'auto',
              minHeight: COMPOSER_MIN_HEIGHT,
              maxHeight: COMPOSER_MAX_HEIGHT,
              caretColor: value ? F.fenway : 'transparent',
            }}
          />
          {(showBlinkingCursor || showStaticCursor) && (
            <div style={{
              position: 'absolute', left: 0, top: 0,
              pointerEvents: 'none', display: 'flex', alignItems: 'center', gap: SPACE.sm,
              height: COMPOSER_MIN_HEIGHT,
            }}>
              <span style={{
                display: 'inline-block', width: 7, height: 14,
                background: showBlinkingCursor ? F.fenway : F.fgFaint,
                animation: showBlinkingCursor ? 'cursor-blink 1.06s steps(2, start) infinite' : 'none',
              }} />
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: TYPE.body.md, color: F.fgFaint, fontStyle: 'normal',
              }}>{placeholder}</span>
            </div>
          )}
        </div>
        {focusBinding && (
          <span title={`Press ${focusBinding === 'main' ? '⌘J' : '⌘B'} to focus · Shift+↩ for newline`} style={{
            flexShrink: 0,
            padding: `2px ${SPACE.xs + 1}px`,
            background: F.surface, border: `1px solid ${F.border}`, borderRadius: RADIUS.sm,
            fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.sm, fontWeight: 600,
            color: F.fgMuted,
            letterSpacing: TRACKING.caps, lineHeight: 1,
          }}>{focusBinding === 'main' ? '⌘J' : '⌘B'}</span>
        )}
      </div>
      {isExpanded && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: SPACE.md,
          marginTop: SPACE.xs + 2, paddingTop: SPACE.xs,
          fontFamily: 'var(--font-mono)', fontSize: TYPE.meta.sm, color: F.fgFaint,
          letterSpacing: TRACKING.caps,
        }}>
          <span><span style={{ color: F.fenway }}>↵</span> send</span>
          <span><span style={{ color: F.fenway }}>shift+↵</span> newline</span>
          <span><span style={{ color: F.fenway }}>/</span> commands</span>
        </div>
      )}
    </div>
  );
}
