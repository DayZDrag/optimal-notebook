import { z } from 'zod';

export const PROTOCOL_VERSION = '1';
export const APP_VERSION = '0.1.6';
export const MAX_TEXT = 100_000;
export const MAX_NOTE_TITLE = 160;
/** Markdown mirror uploads are deliberately smaller than the API body limit. */
export const MAX_VAULT_FILE_BYTES = 256 * 1024;
export const idSchema = z.uuid();
export const dateSchema = z.iso.datetime({ offset: true });
export const noteInputSchema = z.object({
  id: idSchema, deviceId: idSchema, text: z.string().min(1).max(MAX_TEXT).refine(t => !!t.trim(), 'Пустая заметка'),
  clientCreatedAt: dateSchema, contentType: z.literal('text/plain'), source: z.string().max(100),
}).strict();
export type NoteInput = z.infer<typeof noteInputSchema>;
/** A title lives in the RAW Markdown itself so every existing sync target preserves it. */
export function composeNoteRaw(title: string, text: string) {
  const cleanTitle=title.trim();
  if (!cleanTitle) return text;
  if (cleanTitle.length>MAX_NOTE_TITLE || /[\r\n]/.test(cleanTitle)) throw new Error('Название должно быть одной строкой до 160 символов');
  return '# '+cleanTitle+(text ? '\n\n'+text : '');
}
export type NoteStatus = 'LOCAL_PENDING' | 'SERVER_RECEIVED' | 'VAULT_INBOX' | 'AI_PROCESSING' | 'AI_SORTED' | 'SYNC_ERROR' | 'AI_FAILED' | 'NEEDS_REVIEW';
export interface Note extends NoteInput {
  status: NoteStatus; serverReceivedAt?: string; vaultPath?: string; archived?: boolean;
}
export const reminderStatusSchema = z.enum(['PENDING', 'FIRED', 'DONE', 'SNOOZED', 'CANCELLED']);
export const reminderSchema = z.object({
  id: idSchema, noteId: idSchema.nullable(), title: z.string().trim().min(1).max(500),
  body: z.string().max(MAX_TEXT), remindAt: dateSchema,
  timezone: z.string().min(1).max(100).refine(value => { try { new Intl.DateTimeFormat('ru', {timeZone: value}); return true; } catch { return false; } }),
  status: reminderStatusSchema, createdAt: dateSchema, updatedAt: dateSchema, version: z.number().int().positive(),
}).strict();
export type Reminder = z.infer<typeof reminderSchema>;
export const reminderMutationSchema = z.object({ operationId: idSchema, baseVersion: z.number().int().nonnegative(), reminder: reminderSchema }).strict();
export type ReminderMutation = z.infer<typeof reminderMutationSchema>;
export interface SyncEvent { sequence: number; entityType: 'note' | 'reminder'; entityId: string; operation: 'upsert'; payload: Note | Reminder; createdAt: string }
export interface SyncPage { events: SyncEvent[]; nextCursor: string; hasMore: boolean }
export const statusLabels: Record<NoteStatus, string> = {
  LOCAL_PENDING: 'В очереди', SERVER_RECEIVED: 'На сервере', VAULT_INBOX: 'В Obsidian',
  AI_PROCESSING: 'Обрабатывается', AI_SORTED: 'Разобрано', SYNC_ERROR: 'Ошибка синхронизации',
  AI_FAILED: 'Ошибка AI', NEEDS_REVIEW: 'Нужна проверка',
};
export function safeVaultPath(path: string): boolean {
  return path.length > 0 && path.length < 500 && !path.includes('\\') && !/[\x00-\x1f:]/.test(path) &&
    !path.startsWith('/') && path.split('/').every(part => !!part && part !== '.' && part !== '..' && !part.startsWith('.'));
}
export function safeVaultMarkdownPath(path: string): boolean {
  return safeVaultPath(path) && path.toLowerCase().endsWith('.md');
}
export const vaultFileInputSchema = z.object({
  path: z.string().refine(safeVaultMarkdownPath, 'Допустимы только Markdown-файлы внутри vault'),
  content: z.string().max(MAX_VAULT_FILE_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i, 'Нужна SHA-256 сумма'),
  modifiedAt: dateSchema,
}).strict();
export type VaultFileInput = z.infer<typeof vaultFileInputSchema>;
export interface VaultFileMeta {
  path: string; sha256: string; size: number; modifiedAt: string; uploadedAt: string; version: number;
}
export interface VaultSearchResult extends VaultFileMeta { excerpt: string; }
