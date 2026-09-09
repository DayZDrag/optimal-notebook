import Dexie, { type Table } from 'dexie';
import { APP_VERSION, composeNoteRaw, MAX_TEXT, type Note, type NoteInput, type Reminder, type ReminderMutation } from '../../../packages/shared/src/index';

export interface QueueItem {
  seq?: number; operationId: string; entityType: 'note' | 'reminder'; entityId: string;
  payload: NoteInput | ReminderMutation; attempts: number; nextAttemptAt: number;
  error?: string; blocked?: boolean; conflict?: unknown;
}
export interface Settings {
  id: 'settings'; deviceId: string; deviceName: string; serverUrl: string;
  theme: 'terminal' | 'classic-dark' | 'classic-light'; scanlines: boolean; glow: number;
  reducedMotion: boolean; fontSize: 's' | 'm' | 'l'; notifications: boolean; vaultName: string;
}
export interface Meta { key: string; value: unknown }
export class VaultDB extends Dexie {
  notes!: Table<Note,string>; queue!: Table<QueueItem,number>; reminders!: Table<Reminder,string>;
  settings!: Table<Settings,string>; meta!: Table<Meta,string>;
  constructor(name='vault-terminal') {
    super(name);
    this.version(1).stores({notes:'id,clientCreatedAt,status',queue:'++seq,&operationId,entityId,nextAttemptAt',reminders:'id,remindAt,status',settings:'id',meta:'key'});
  }
}
export const db=new VaultDB();
export async function getSettings(database=db): Promise<Settings> {
  return database.transaction('rw',database.settings,async()=>{
    const current=await database.settings.get('settings'); if(current) return current;
    const initial:Settings={id:'settings',deviceId:crypto.randomUUID(),deviceName:'Моё устройство',serverUrl:'',theme:'terminal',scanlines:false,glow:20,reducedMotion:true,fontSize:'m',notifications:false,vaultName:''};
    await database.settings.put(initial); return initial;
  });
}
export async function saveNote(text: string,titleOrDatabase: string|VaultDB='',database=db) {
  const title=typeof titleOrDatabase==='string' ? titleOrDatabase : '';
  const targetDatabase=typeof titleOrDatabase==='string' ? database : titleOrDatabase;
  const rawText=composeNoteRaw(title,text);
  if (!rawText.trim() || rawText.length>MAX_TEXT) throw new Error('Введите текст и название общей длиной до 100 000 символов');
  const settings=await getSettings(targetDatabase);
  const input:NoteInput={id:crypto.randomUUID(),deviceId:settings.deviceId,text:rawText,clientCreatedAt:new Date().toISOString(),contentType:'text/plain',source:'vault-terminal-web'};
  await targetDatabase.transaction('rw',targetDatabase.notes,targetDatabase.queue,async()=>{
    await targetDatabase.notes.add({...input,status:'LOCAL_PENDING'});
    await targetDatabase.queue.add({operationId:input.id,entityId:input.id,entityType:'note',payload:input,attempts:0,nextAttemptAt:0});
  });
  return input.id;
}
export async function saveReminder(input: Omit<Reminder,'id'|'createdAt'|'updatedAt'|'version'> & {id?:string}, database=db) {
  return database.transaction('rw',database.reminders,database.queue,async()=>{
    const previous=input.id ? await database.reminders.get(input.id) : undefined;
    const now=new Date().toISOString();
    const reminder:Reminder={...input,id:input.id ?? crypto.randomUUID(),createdAt:previous?.createdAt ?? now,updatedAt:now,version:(previous?.version ?? 0)+1};
    const operationId=crypto.randomUUID();
    await database.reminders.put(reminder);
    await database.queue.add({operationId,entityId:reminder.id,entityType:'reminder',payload:{operationId,baseVersion:previous?.version ?? 0,reminder},attempts:0,nextAttemptAt:0});
    return reminder;
  });
}
export async function exportData(database=db) {
  return database.transaction('r',database.notes,database.queue,database.reminders,database.meta,async()=>({
    format:'vault-terminal-raw-v1',appVersion:APP_VERSION,exportedAt:new Date().toISOString(),
    notes:await database.notes.toArray(),reminders:await database.reminders.toArray(),queue:await database.queue.toArray(),
    recovery:await database.meta.filter(m=>m.key.startsWith('conflict:')).toArray(),
  }));
}
// An explicit user action preserves the rejected version and commands before replacing them.
export async function preserveReminderConflict(entityId:string,database=db) {
  await database.transaction('rw',database.queue,database.reminders,database.meta,async()=>{
    const operations=await database.queue.where('entityId').equals(entityId).toArray();
    const local=await database.reminders.get(entityId);
    if (!local || !operations.some(o=>o.blocked)) return;
    const current=operations.find(o=>o.conflict)?.conflict as Reminder | undefined;
    await database.meta.put({key:'conflict:'+crypto.randomUUID(),value:{local,operations,current,savedAt:new Date().toISOString()}});
    await database.queue.bulkDelete(operations.map(o=>o.seq!));
    if (current) await database.reminders.put(current); else await database.reminders.delete(entityId);
    const copy:Reminder={...local,id:crypto.randomUUID(),title:local.title+' (локальная копия)',version:1,createdAt:new Date().toISOString()};
    await database.reminders.add(copy);
    const operationId=crypto.randomUUID();
    await database.queue.add({operationId,entityId:copy.id,entityType:'reminder',payload:{operationId,baseVersion:0,reminder:copy},attempts:0,nextAttemptAt:0});
  });
}
