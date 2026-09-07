import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { Note, NoteInput, Reminder, ReminderMutation, SyncEvent, SyncPage } from '../../shared/src/index';

export class ConflictError extends Error {
  constructor(message: string, public current?: unknown) { super(message); }
}
export interface Device { id: string; name: string; role: 'client' | 'desktop'; revoked: number }
export interface StorageAdapter {
  putNote(input: NoteInput): { note: Note; created: boolean };
  getNote(id: string): Note | undefined;
  listNotes(): Note[];
  mutateReminder(input: ReminderMutation): { reminder: Reminder; created: boolean };
  getReminder(id: string): Reminder | undefined;
  listReminders(): Reminder[];
  sync(cursor: number): SyncPage;
  acknowledge(deviceId: string, cursor: number, notes: {id: string; path: string}[]): void;
  addDevice(id: string, name: string, role: Device['role'], token?: string): void;
  authenticate(token: string): Device | undefined;
  getDevice(id: string): Device | undefined;
  addSession(token: string, deviceId: string): void;
  authenticateSession(token: string): Device | undefined;
  revokeDevice(id: string): void;
  close(): void;
}
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const now = () => new Date().toISOString();
export class SqliteStore implements StorageAdapter {
  readonly db: DatabaseSync;
  constructor(path = './data/vault-terminal.sqlite') {
    if (path !== ':memory:') mkdirSync(dirname(resolve(path)), {recursive: true});
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA busy_timeout=5000');
    this.db.exec(readFileSync(resolve('packages/db/schema.sql'), 'utf8'));
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  private event(entityType: 'note' | 'reminder', entityId: string, payload: Note | Reminder) {
    this.db.prepare('INSERT INTO sync_events(entity_type,entity_id,operation,payload,created_at) VALUES (?,?,\'upsert\',?,?)').run(entityType, entityId, JSON.stringify(payload), now());
  }
  getNote(id: string): Note | undefined {
    const r = this.db.prepare('SELECT * FROM raw_notes WHERE id=?').get(id);
    return r ? {id: String(r.id), deviceId: String(r.device_id), text: String(r.text), contentType: 'text/plain', clientCreatedAt: String(r.client_created_at), source: String(r.source), serverReceivedAt: String(r.server_received_at), status: r.status as Note['status'], ...(r.vault_path ? {vaultPath: String(r.vault_path)} : {})} : undefined;
  }
  listNotes() { return this.db.prepare('SELECT id FROM raw_notes ORDER BY server_received_at DESC').all().map(r => this.getNote(String(r.id))!); }
  putNote(input: NoteInput) {
    return this.transaction(() => {
      const existing = this.getNote(input.id);
      if (existing) {
        for (const key of ['text','deviceId','clientCreatedAt','contentType','source'] as const) {
          if (input[key] !== existing[key]) throw new ConflictError('UUID уже принадлежит другому RAW-оригиналу. Обе версии сохранены на своих устройствах.', existing);
        }
        return {note: existing, created: false};
      }
      this.db.prepare('INSERT INTO raw_notes(id,device_id,text,content_type,client_created_at,server_received_at,source) VALUES (?,?,?,?,?,?,?)').run(input.id,input.deviceId,input.text,input.contentType,input.clientCreatedAt,now(),input.source);
      const note = this.getNote(input.id)!; this.event('note', note.id, note);
      return {note, created: true};
    });
  }
  getReminder(id: string): Reminder | undefined {
    const row = this.db.prepare('SELECT data FROM reminders WHERE id=?').get(id);
    return row ? JSON.parse(String(row.data)) as Reminder : undefined;
  }
  listReminders() { return this.db.prepare('SELECT data FROM reminders').all().map(r => JSON.parse(String(r.data)) as Reminder); }
  mutateReminder(input: ReminderMutation) {
    return this.transaction(() => {
      const receipt = this.db.prepare('SELECT request,response FROM mutation_receipts WHERE operation_id=?').get(input.operationId);
      if (receipt) {
        if (receipt.request !== JSON.stringify(input)) throw new ConflictError('Operation ID уже использован');
        return {reminder: JSON.parse(String(receipt.response)) as Reminder, created: false};
      }
      const old = this.getReminder(input.reminder.id);
      if ((old?.version ?? 0) !== input.baseVersion) throw new ConflictError('Напоминание изменено на другом устройстве. Локальная версия осталась в очереди.', old);
      if (input.reminder.version !== input.baseVersion + 1) throw new ConflictError('Некорректная версия напоминания', old);
      if (old && (old.createdAt !== input.reminder.createdAt || old.noteId !== input.reminder.noteId)) throw new ConflictError('Нельзя изменить происхождение напоминания', old);
      const reminder = input.reminder;
      this.db.prepare('INSERT INTO reminders VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version,data=excluded.data').run(reminder.id,reminder.version,JSON.stringify(reminder));
      this.db.prepare('INSERT INTO mutation_receipts VALUES (?,?,?)').run(input.operationId,JSON.stringify(input),JSON.stringify(reminder));
      this.event('reminder', reminder.id, reminder);
      if (reminder.status === 'CANCELLED') this.db.prepare('INSERT INTO audit_log(device_id,operation,entity_id,created_at) VALUES (?,?,?,?)').run('device-operation:'+input.operationId,'CANCEL_REMINDER',reminder.id,now());
      return {reminder, created: !old};
    });
  }
  sync(cursor: number): SyncPage {
    const rows = this.db.prepare('SELECT * FROM sync_events WHERE sequence>? ORDER BY sequence LIMIT 201').all(cursor);
    const events = rows.slice(0,200).map(r => ({sequence: Number(r.sequence),entityType: r.entity_type, entityId: r.entity_id,operation: r.operation,payload: JSON.parse(String(r.payload)),createdAt: r.created_at})) as SyncEvent[];
    return {events, nextCursor: String(events.at(-1)?.sequence ?? cursor), hasMore: rows.length > 200};
  }
  acknowledge(deviceId: string, cursor: number, notes: {id: string; path: string}[]) {
    this.transaction(() => {
      const max = Number(this.db.prepare('SELECT COALESCE(MAX(sequence),0) AS value FROM sync_events').get()!.value);
      if (cursor > max) throw new ConflictError('Cursor за пределами журнала');
      for (const item of notes) {
        const note = this.getNote(item.id);
        if (!note) throw new ConflictError('Заметка не найдена');
        if (note.status === 'SERVER_RECEIVED') {
          this.db.prepare('UPDATE raw_notes SET status=?,vault_path=? WHERE id=?').run(item.path.startsWith('Conflicts/')?'NEEDS_REVIEW':'VAULT_INBOX',item.path,item.id);
          this.event('note',item.id,this.getNote(item.id)!);
        }
      }
      this.db.prepare('UPDATE devices SET cursor=MAX(cursor,?),last_seen_at=? WHERE id=?').run(cursor,now(),deviceId);
    });
  }
  addDevice(id: string, name: string, role: Device['role'], token?: string) {
    this.db.prepare('INSERT OR IGNORE INTO devices(id,name,role,token_hash) VALUES (?,?,?,?)').run(id,name,role,token ? hash(token) : null);
  }
  getDevice(id: string) { return this.db.prepare('SELECT id,name,role,revoked FROM devices WHERE id=? AND revoked=0').get(id) as Device | undefined; }
  authenticate(token: string) { return this.db.prepare('SELECT id,name,role,revoked FROM devices WHERE token_hash=? AND revoked=0').get(hash(token)) as Device | undefined; }
  addSession(token: string, deviceId: string) { this.db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(token),deviceId,Date.now()+30*86400000); }
  authenticateSession(token: string) { return this.db.prepare('SELECT d.id,d.name,d.role,d.revoked FROM sessions s JOIN devices d ON d.id=s.device_id WHERE s.token_hash=? AND s.expires_at>? AND d.revoked=0').get(hash(token),Date.now()) as Device | undefined; }
  revokeDevice(id: string) {
    this.transaction(() => {
      this.db.prepare('UPDATE devices SET revoked=1 WHERE id=?').run(id);
      this.db.prepare('DELETE FROM sessions WHERE device_id=?').run(id);
      this.db.prepare('INSERT INTO audit_log(device_id,operation,entity_id,created_at) VALUES (?,?,?,?)').run('admin','REVOKE_DEVICE',id,now());
    });
  }
  close() { this.db.close(); }
}
