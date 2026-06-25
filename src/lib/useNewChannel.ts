import { useCallback } from 'react';
import { createSession, UNTITLED_CHANNEL_LABEL } from '../api/sessions';
import { fire } from './events';
import { useSessions, useToasts, useUi } from '../store';

/**
 * Phase 9.2 — one-click "new channel" flow. Replaces the old SessionCreator +
 * BriefCreator modals. Creates an Untitled channel server-side, navigates the
 * user into it, and focuses the channel composer so they can immediately type
 * the first question. SessionFeed renames the session from the question on
 * the first brief submit.
 */
export function useNewChannel() {
  const { insertSession } = useSessions();
  const {
    setExpandedBrief, setRightPanelMode, setRightPanelOpen, setActiveNav,
  } = useUi();
  const { pushToast } = useToasts();

  return useCallback(async () => {
    try {
      const session = await createSession(UNTITLED_CHANNEL_LABEL);
      // insertSession also sets activeSessionId, so navigation lands in the
      // new channel on the next paint.
      insertSession(session);
      setExpandedBrief(null);
      setRightPanelMode('list');
      setRightPanelOpen(true);
      setActiveNav('analyze');
      // Composer mounts on the next render — defer focus until then.
      setTimeout(() => fire('v6d3cf:focus-composer'), 50);
    } catch (err) {
      pushToast({
        tone: 'error',
        message: 'Couldn’t start new channel',
        detail: err instanceof Error ? err.message : 'Server error.',
      });
    }
  }, [insertSession, setExpandedBrief, setRightPanelMode, setRightPanelOpen, setActiveNav, pushToast]);
}
