import { NotImplementedError } from './client';

export async function toggleBookmark(_briefId: string): Promise<boolean> {
  throw new NotImplementedError(5, 'toggleBookmark');
}

export async function listBookmarks(): Promise<string[]> {
  throw new NotImplementedError(5, 'listBookmarks');
}
