import type { StateCreator } from 'zustand';

export type ToastTone = 'info' | 'error' | 'success';

export interface Toast {
  id: string;
  tone: ToastTone;
  message: string;
  /** Optional sub-line for context — e.g. error detail, brief title. */
  detail?: string;
  /** Auto-dismiss after this many ms. Defaults to 4000. */
  ttl_ms?: number;
}

export interface ToastsSlice {
  toasts: Toast[];
  pushToast: (t: Omit<Toast, 'id'>) => string;
  dismissToast: (id: string) => void;
}

let counter = 0;
const nextId = () => `t-${Date.now()}-${counter++}`;

export const createToastsSlice: StateCreator<ToastsSlice, [], [], ToastsSlice> = (set) => ({
  toasts: [],
  pushToast: (t) => {
    const id = nextId();
    set((s) => ({ toasts: [...s.toasts, { id, ...t }] }));
    return id;
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
});
