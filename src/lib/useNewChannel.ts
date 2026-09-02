import { useCallback } from 'react';
import { fire } from './events';
import { useBriefs, useSessions, useUi } from '../store';

/**
 * Start a local draft channel. Nothing is persisted until its first question;
 * SessionFeed creates the workspace and brief together on submit.
 */
export function useNewChannel() {
  const { setActiveSession } = useSessions();
  const { setActiveBrief } = useBriefs();
  const {
    setExpandedBrief, setRightPanelMode, setRightPanelOpen, setActiveNav,
  } = useUi();
  return useCallback(() => {
    setActiveSession(null);
    setActiveBrief(null);
    setExpandedBrief(null);
    setRightPanelMode('list');
    setRightPanelOpen(true);
    setActiveNav('analyze');
    setTimeout(() => fire('v6d3cf:focus-composer'), 50);
  }, [setActiveSession, setActiveBrief, setExpandedBrief, setRightPanelMode, setRightPanelOpen, setActiveNav]);
}
