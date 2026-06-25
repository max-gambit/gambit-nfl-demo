import type { Toast } from './toasts';

// Cross-slice helper: lets non-UI code (slice actions, api wrappers) push a
// toast without importing the root store directly, which would create a hard
// circular dependency. The Toaster registers `setHandler` on mount.

type ToastHandler = (t: Omit<Toast, 'id'>) => string;

let handler: ToastHandler | null = null;

export function setToastHandler(h: ToastHandler | null): void {
  handler = h;
}

export function toast(t: Omit<Toast, 'id'>): void {
  if (!handler) {
    // No registered handler — log and continue. Happens before mount.
    console.warn('[toast]', t.tone, t.message, t.detail ?? '');
    return;
  }
  handler(t);
}
