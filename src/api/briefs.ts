import type {
  AddBriefShareRecipientRequest, Brief, BriefMode, BriefShare, BriefShareLink,
  BriefShareLinkResponse, BriefShareRecipientResponse, BriefShareSnapshot, CreateBriefRequest,
  CreateBriefResponse, CreateSavedBriefTemplateRequest, BriefTemplateSelection,
  CreateSavedBriefTemplateResponse, ListBriefTemplatesResponse, RegenerateBriefRequest,
  ResolveBriefShareLinkResponse, SavedBriefTemplate, Session,
} from '@shared/types';
import { postJson, SERVER_URL, supabase, NotImplementedError } from './client';
import { createSession } from './sessions';
import { stripBriefModePrefix } from '@shared/briefMode';

export async function createBrief(req: CreateBriefRequest): Promise<Brief> {
  const res = await postJson<CreateBriefResponse>('/briefs', req);
  return res.brief;
}

export async function regenerateBrief(briefId: string, req: RegenerateBriefRequest = {}): Promise<Brief> {
  const res = await postJson<{ brief: Brief }>(`/briefs/${briefId}/regenerate`, req);
  return res.brief;
}

export function briefProgressStreamUrl(briefId: string): string {
  return `${SERVER_URL}/briefs/${encodeURIComponent(briefId)}/progress-stream`;
}

export async function listBriefTemplates(): Promise<ListBriefTemplatesResponse> {
  const res = await fetch(`${SERVER_URL}/briefs/templates`);
  if (!res.ok) throw new Error(`load templates failed: ${res.status}`);
  return res.json() as Promise<ListBriefTemplatesResponse>;
}

export async function saveBriefTemplate(req: CreateSavedBriefTemplateRequest): Promise<SavedBriefTemplate> {
  const res = await postJson<CreateSavedBriefTemplateResponse>('/briefs/templates', req);
  return res.template;
}

export async function getBriefShareSnapshot(briefId: string, teamId = 'GSW'): Promise<BriefShareSnapshot> {
  const params = new URLSearchParams({ team_id: teamId });
  const res = await fetch(`${SERVER_URL}/briefs/${briefId}/share?${params.toString()}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET /briefs/${briefId}/share failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<BriefShareSnapshot>;
}

export async function shareBriefWithRecipient(
  briefId: string,
  req: AddBriefShareRecipientRequest,
): Promise<BriefShare> {
  const res = await postJson<BriefShareRecipientResponse>(`/briefs/${briefId}/share/recipients`, req);
  return res.share;
}

export async function revokeBriefShare(briefId: string, shareId: string): Promise<BriefShare> {
  const res = await fetch(`${SERVER_URL}/briefs/${briefId}/share/recipients/${shareId}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`DELETE /briefs/${briefId}/share/recipients/${shareId} failed: ${res.status} ${text}`);
  }
  const body = await res.json() as BriefShareRecipientResponse;
  return body.share;
}

export async function createBriefShareLink(briefId: string): Promise<BriefShareLink> {
  const res = await postJson<BriefShareLinkResponse>(`/briefs/${briefId}/share/link`, {});
  return res.link;
}

export async function resolveBriefShareToken(token: string): Promise<ResolveBriefShareLinkResponse> {
  const res = await fetch(`${SERVER_URL}/briefs/share/${encodeURIComponent(token)}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GET /briefs/share/${token} failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<ResolveBriefShareLinkResponse>;
}

/**
 * First-run convenience: when the user types a question with no active
 * session, auto-create a session (labeled from the question) so they can
 * skip the explicit "create session" step. Returns both rows so callers can
 * update the store atomically.
 *
 * Use when caller knows there's no session yet; otherwise call createBrief
 * directly with the existing session_id.
 */
export async function createBriefWithSession(
  question: string,
  mode?: BriefMode,
  template?: BriefTemplateSelection,
): Promise<{ session: Session; brief: Brief }> {
  const parsed = stripBriefModePrefix(question);
  const trimmed = parsed.question.trim();
  const briefMode = mode ?? parsed.mode ?? undefined;
  const label = deriveSessionLabel(trimmed);
  const session = await createSession(label);
  const brief = await createBrief({ session_id: session.id, question: trimmed, mode: briefMode, template });
  return { session, brief };
}

function deriveSessionLabel(question: string): string {
  // First sentence (or up to 60 chars), trailing punctuation stripped.
  const firstSentence = question.split(/[.?!]\s/)[0] ?? question;
  const cleaned = firstSentence.trim().replace(/[.?!]+$/, '');
  if (cleaned.length <= 60) return cleaned || 'Workspace';
  return `${cleaned.slice(0, 57).trimEnd()}…`;
}

/** Poll a generating brief until it flips to ready or failed. */
export async function pollBriefUntilDone(
  briefId: string,
  opts: { intervalMs?: number; timeoutMs?: number } = {},
): Promise<Brief> {
  const interval = opts.intervalMs ?? 2000;
  const timeout = opts.timeoutMs ?? 120_000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    const { data, error } = await supabase
      .from('briefs')
      .select('*')
      .eq('id', briefId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error(`brief ${briefId} not found`);
    const brief = data as Brief;
    if (brief.status === 'ready' || brief.status === 'failed') return brief;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`brief ${briefId} did not finish within ${timeout}ms`);
}

export async function listBriefs(_sessionId: string): Promise<Brief[]> {
  throw new NotImplementedError(2, 'listBriefs');
}

export async function getBrief(id: string): Promise<Brief> {
  const { data, error } = await supabase
    .from('briefs')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error(`brief ${id} not found`);
  return data as Brief;
}
