import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';
import type { Note, NoteInput, Reminder, ReminderMutation, SyncEvent, SyncPage } from '../../shared/src/index';

export class ConflictError extends Error {
  constructor(message: string, public current?: unknown) { super(message); }
}
export interface Device { id: string; name: string; role: 'client' | 'desktop'; revoked: number }
export interface StorageAdapter {
  putNote(input: NoteInput): { note: Note; created: boolean } | Promise<{ note: Note; created: boolean }>;
  getNote(id: string): Note | undefined | Promise<Note | undefined>;
  listNotes(): Note[] | Promise<Note[]>;
  mutateReminder(input: ReminderMutation): { reminder: Reminder; created: boolean } | Promise<{ reminder: Reminder; created: boolean }>;
  getReminder(id: string): Reminder | undefined | Promise<Reminder | undefined>;
  listReminders(): Reminder[] | Promise<Reminder[]>;
  sync(cursor: number): SyncPage | Promise<SyncPage>;
  acknowledge(deviceId: string, cursor: number, notes: {id: string; path: string}[]): void | Promise<void>;
  addDevice(id: string, name: string, role: Device['role'], token?: string): void | Promise<void>;
  authenticate(token: string): Device | undefined | Promise<Device | undefined>;
  getDevice(id: string): Device | undefined | Promise<Device | undefined>;
  addSession(token: string, deviceId: string): void | Promise<void>;
  authenticateSession(token: string): Device | undefined | Promise<Device | undefined>;
  revokeDevice(id: string): void | Promise<void>;
  close(): void | Promise<void>;
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

const postgresSchema = `
CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('client','desktop')), token_hash TEXT UNIQUE, revoked BOOLEAN NOT NULL DEFAULT FALSE, last_seen_at TEXT, cursor BIGINT NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id), expires_at BIGINT NOT NULL);
CREATE TABLE IF NOT EXISTS raw_notes (id TEXT PRIMARY KEY, device_id TEXT NOT NULL, text TEXT NOT NULL, content_type TEXT NOT NULL, client_created_at TEXT NOT NULL, server_received_at TEXT NOT NULL, source TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'SERVER_RECEIVED', vault_path TEXT, deleted BOOLEAN NOT NULL DEFAULT FALSE);
CREATE TABLE IF NOT EXISTS reminders (id TEXT PRIMARY KEY, version INTEGER NOT NULL, data JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS mutation_receipts (operation_id TEXT PRIMARY KEY, request TEXT NOT NULL, response JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS sync_events (sequence BIGSERIAL PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, operation TEXT NOT NULL, payload JSONB NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS event_entity ON sync_events(entity_type, entity_id);
CREATE TABLE IF NOT EXISTS audit_log (id BIGSERIAL PRIMARY KEY, device_id TEXT NOT NULL, operation TEXT NOT NULL, entity_id TEXT, created_at TEXT NOT NULL);
CREATE OR REPLACE FUNCTION reject_raw_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'RAW is immutable'; END; $$;
CREATE OR REPLACE FUNCTION reject_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Append-only log'; END; $$;
DROP TRIGGER IF EXISTS protect_raw_update ON raw_notes;
CREATE TRIGGER protect_raw_update BEFORE UPDATE OF text, device_id, content_type, client_created_at, source ON raw_notes FOR EACH ROW EXECUTE FUNCTION reject_raw_mutation();
DROP TRIGGER IF EXISTS protect_raw_delete ON raw_notes;
CREATE TRIGGER protect_raw_delete BEFORE DELETE ON raw_notes FOR EACH ROW EXECUTE FUNCTION reject_raw_mutation();
DROP TRIGGER IF EXISTS protect_event_update ON sync_events;
CREATE TRIGGER protect_event_update BEFORE UPDATE ON sync_events FOR EACH ROW EXECUTE FUNCTION reject_event_mutation();
DROP TRIGGER IF EXISTS protect_event_delete ON sync_events;
CREATE TRIGGER protect_event_delete BEFORE DELETE ON sync_events FOR EACH ROW EXECUTE FUNCTION reject_event_mutation();`;

type PgRow = Record<string, unknown>;
const asDevice = (row: PgRow): Device => ({id:String(row.id),name:String(row.name),role:row.role as Device['role'],revoked:row.revoked ? 1 : 0});
const asNote = (row: PgRow): Note => ({id:String(row.id),deviceId:String(row.device_id),text:String(row.text),contentType:'text/plain',clientCreatedAt:String(row.client_created_at),source:String(row.source),serverReceivedAt:String(row.server_received_at),status:row.status as Note['status'],...(row.vault_path ? {vaultPath:String(row.vault_path)} : {})});

/** Persistent, serverless-safe storage for Vercel Functions and Neon PostgreSQL. */
export class PostgresStore implements StorageAdapter {
  readonly pool: Pool;
  private readonly ready: Promise<void>;
  constructor(connectionString: string) {
    this.pool=new Pool({connectionString,ssl: connectionString.includes('localhost') ? false : {rejectUnauthorized:true},max:5});
    this.ready=this.pool.query(postgresSchema).then(()=>undefined);
  }
  private async query<T extends PgRow = PgRow>(text: string, values: unknown[]=[]): Promise<T[]> { await this.ready; return (await this.pool.query<T>(text,values)).rows; }
  private async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> { await this.ready; const client=await this.pool.connect(); try { await client.query('BEGIN'); const result=await fn(client); await client.query('COMMIT'); return result; } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); } }
  async getNote(id: string) { const [row]=await this.query('SELECT * FROM raw_notes WHERE id=$1',[id]); return row ? asNote(row) : undefined; }
  async listNotes() { const rows=await this.query('SELECT * FROM raw_notes ORDER BY server_received_at DESC'); return rows.map(asNote); }
  async putNote(input: NoteInput) { return this.transaction(async client => { const existing=(await client.query<PgRow>('SELECT * FROM raw_notes WHERE id=$1 FOR UPDATE',[input.id])).rows[0]; if (existing) { const note=asNote(existing); for(const key of ['text','deviceId','clientCreatedAt','contentType','source'] as const) if(input[key]!==note[key]) throw new ConflictError('UUID уже принадлежит другому RAW-оригиналу. Обе версии сохранены на своих устройствах.',note); return {note,created:false}; } const receivedAt=now(); await client.query('INSERT INTO raw_notes(id,device_id,text,content_type,client_created_at,server_received_at,source) VALUES ($1,$2,$3,$4,$5,$6,$7)',[input.id,input.deviceId,input.text,input.contentType,input.clientCreatedAt,receivedAt,input.source]); const note:Note={...input,serverReceivedAt:receivedAt,status:'SERVER_RECEIVED'}; await client.query("INSERT INTO sync_events(entity_type,entity_id,operation,payload,created_at) VALUES ('note',$1,'upsert',$2,$3)",[note.id,JSON.stringify(note),now()]); return {note,created:true}; }); }
  async getReminder(id: string) { const [row]=await this.query('SELECT data FROM reminders WHERE id=$1',[id]); return row ? row.data as Reminder : undefined; }
  async listReminders() { const rows=await this.query('SELECT data FROM reminders'); return rows.map(row=>row.data as Reminder); }
  async mutateReminder(input: ReminderMutation) { return this.transaction(async client => { const receipt=(await client.query<PgRow>('SELECT request,response FROM mutation_receipts WHERE operation_id=$1 FOR UPDATE',[input.operationId])).rows[0]; if(receipt) { if(receipt.request!==JSON.stringify(input)) throw new ConflictError('Operation ID уже использован'); return {reminder:receipt.response as Reminder,created:false}; } const oldRow=(await client.query<PgRow>('SELECT data FROM reminders WHERE id=$1 FOR UPDATE',[input.reminder.id])).rows[0]; const old=oldRow?.data as Reminder|undefined; if((old?.version ?? 0)!==input.baseVersion) throw new ConflictError('Напоминание изменено на другом устройстве. Локальная версия осталась в очереди.',old); if(input.reminder.version!==input.baseVersion+1) throw new ConflictError('Некорректная версия напоминания',old); if(old && (old.createdAt!==input.reminder.createdAt || old.noteId!==input.reminder.noteId)) throw new ConflictError('Нельзя изменить происхождение напоминания',old); const reminder=input.reminder; await client.query('INSERT INTO reminders(id,version,data) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET version=EXCLUDED.version,data=EXCLUDED.data',[reminder.id,reminder.version,JSON.stringify(reminder)]); await client.query('INSERT INTO mutation_receipts(operation_id,request,response) VALUES($1,$2,$3)',[input.operationId,JSON.stringify(input),JSON.stringify(reminder)]); await client.query("INSERT INTO sync_events(entity_type,entity_id,operation,payload,created_at) VALUES ('reminder',$1,'upsert',$2,$3)",[reminder.id,JSON.stringify(reminder),now()]); if(reminder.status==='CANCELLED') await client.query("INSERT INTO audit_log(device_id,operation,entity_id,created_at) VALUES($1,'CANCEL_REMINDER',$2,$3)",['device-operation:'+input.operationId,reminder.id,now()]); return {reminder,created:!old}; }); }
  async sync(cursor: number) { const rows=await this.query('SELECT * FROM sync_events WHERE sequence>$1 ORDER BY sequence LIMIT 201',[cursor]); const events=rows.slice(0,200).map(row=>({sequence:Number(row.sequence),entityType:row.entity_type,entityId:row.entity_id,operation:row.operation,payload:row.payload,createdAt:row.created_at})) as SyncEvent[]; return {events,nextCursor:String(events.at(-1)?.sequence ?? cursor),hasMore:rows.length>200}; }
  async acknowledge(deviceId: string,cursor: number,notes: {id:string;path:string}[]) { await this.transaction(async client => { const max=Number((await client.query<PgRow>('SELECT COALESCE(MAX(sequence),0) AS value FROM sync_events')).rows[0].value); if(cursor>max) throw new ConflictError('Cursor за пределами журнала'); for(const item of notes) { const row=(await client.query<PgRow>('SELECT * FROM raw_notes WHERE id=$1 FOR UPDATE',[item.id])).rows[0]; if(!row) throw new ConflictError('Заметка не найдена'); const note=asNote(row); if(note.status==='SERVER_RECEIVED') { await client.query('UPDATE raw_notes SET status=$1,vault_path=$2 WHERE id=$3',[item.path.startsWith('Conflicts/') ? 'NEEDS_REVIEW' : 'VAULT_INBOX',item.path,note.id]); const changed=await client.query<PgRow>('SELECT * FROM raw_notes WHERE id=$1',[note.id]); await client.query("INSERT INTO sync_events(entity_type,entity_id,operation,payload,created_at) VALUES ('note',$1,'upsert',$2,$3)",[note.id,JSON.stringify(asNote(changed.rows[0])),now()]); } } await client.query('UPDATE devices SET cursor=GREATEST(cursor,$1),last_seen_at=$2 WHERE id=$3',[cursor,now(),deviceId]); }); }
  async addDevice(id:string,name:string,role:Device['role'],token?:string) { await this.query('INSERT INTO devices(id,name,role,token_hash) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING',[id,name,role,token ? hash(token) : null]); }
  async getDevice(id:string) { const [row]=await this.query('SELECT * FROM devices WHERE id=$1 AND revoked=FALSE',[id]); return row ? asDevice(row) : undefined; }
  async authenticate(token:string) { const [row]=await this.query('SELECT * FROM devices WHERE token_hash=$1 AND revoked=FALSE',[hash(token)]); return row ? asDevice(row) : undefined; }
  async addSession(token:string,deviceId:string) { await this.query('INSERT INTO sessions(token_hash,device_id,expires_at) VALUES($1,$2,$3)',[hash(token),deviceId,Date.now()+30*86400_000]); }
  async authenticateSession(token:string) { const [row]=await this.query('SELECT d.* FROM sessions s JOIN devices d ON d.id=s.device_id WHERE s.token_hash=$1 AND s.expires_at>$2 AND d.revoked=FALSE',[hash(token),Date.now()]); return row ? asDevice(row) : undefined; }
  async revokeDevice(id:string) { await this.transaction(async client=>{await client.query('UPDATE devices SET revoked=TRUE WHERE id=$1',[id]);await client.query('DELETE FROM sessions WHERE device_id=$1',[id]);await client.query("INSERT INTO audit_log(device_id,operation,entity_id,created_at) VALUES ('admin','REVOKE_DEVICE',$1,$2)",[id,now()]);}); }
  async close() { await this.pool.end(); }
}
