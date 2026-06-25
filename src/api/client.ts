// API client setup — Hono server URL + Supabase JS client.
// All other src/api/* modules call through these.

import { createClient } from '@supabase/supabase-js';

export const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:8787';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    '[api] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY not set. ' +
      'Reads from Supabase will fail until you copy .env.example to .env.local and fill in your project credentials.',
  );
}

export const supabase = createClient(
  supabaseUrl ?? 'http://placeholder',
  supabaseAnonKey ?? 'placeholder',
  { auth: { persistSession: false } },
);

export class NotImplementedError extends Error {
  constructor(public readonly phase: number, public readonly endpoint: string) {
    super(`${endpoint} is not implemented yet (phase ${phase})`);
    this.name = 'NotImplementedError';
  }
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${SERVER_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST ${path} failed: ${res.status} ${text}`);
  }
  return res.json() as Promise<T>;
}
