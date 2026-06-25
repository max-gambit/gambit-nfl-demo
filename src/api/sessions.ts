import type { Session } from '@shared/types';
import { supabase, NotImplementedError } from './client';

export async function listSessions(): Promise<Session[]> {
  throw new NotImplementedError(2, 'listSessions');
}

export async function createSession(label: string): Promise<Session> {
  const { data, error } = await supabase
    .from('sessions')
    .insert({ label })
    .select()
    .single();
  if (error || !data) throw error ?? new Error('createSession failed');
  return data as Session;
}

export async function renameSession(id: string, label: string): Promise<void> {
  const { error } = await supabase.from('sessions').update({ label }).eq('id', id);
  if (error) throw error;
}

export async function archiveSession(id: string): Promise<void> {
  const { error } = await supabase
    .from('sessions')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

export async function deleteSession(id: string): Promise<void> {
  const { error } = await supabase.from('sessions').delete().eq('id', id);
  if (error) throw error;
}

/** Placeholder label used when a channel is created via the +New flow before
 *  the user has typed their first question. SessionFeed swaps this for a
 *  derived label on the first brief submit. */
export const UNTITLED_CHANNEL_LABEL = 'Untitled';

/** First sentence of `question` (≤60 chars), trailing punctuation stripped.
 *  Used as the auto-derived session label when the user submits the first
 *  brief in an Untitled channel. */
export function deriveChannelLabel(question: string): string {
  const firstSentence = question.split(/[.?!]\s/)[0] ?? question;
  const cleaned = firstSentence.trim().replace(/[.?!]+$/, '');
  if (cleaned.length === 0) return UNTITLED_CHANNEL_LABEL;
  if (cleaned.length <= 60) return cleaned;
  return `${cleaned.slice(0, 57).trimEnd()}…`;
}
