import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteStore } from '../packages/db/src/store';
import { createApp } from '../apps/server/src/app';
import { VaultDB, exportData, getSettings, preserveReminderConflict, saveNote, saveReminder } from '../apps/web/src/db';
import { syncNow } from '../apps/web/src/sync';
import { APP_VERSION, PROTOCOL_VERSION, type NoteInput, type Reminder } from '../packages/shared/src/index';
import { forwardVercelRequest } from '../apps/server/src/vercel-adapter';
import { appendVoiceText } from '../apps/web/src/voice';

const stores:SqliteStore[]=[]; const databases:VaultDB[]=[]; const temporary:string[]=[];
afterEach(async()=>{for(const d of databases.splice(0))await d.delete();for(const s of stores.splice(0))s.close();for(const p of temporary.splice(0))rmSync(p,{recursive:true,force:true});});
function setup(authRequired=false,secureCookies=false) {
  const store=new SqliteStore(':memory:');stores.push(store);
  const app=createApp(store,{authRequired,origin:'http://localhost:5173',secureCookies});
  const database=new VaultDB('test-'+randomUUID());databases.push(database);
  const fetcher:typeof fetch=async(input,init)=>app.request('http://localhost'+String(input),init);
  return {store,app,database,fetcher};
}
const note=():NoteInput=>({id:randomUUID(),deviceId:randomUUID(),text:'  RAW\r\nТекст 🐝\n\n',clientCreatedAt:new Date().toISOString(),contentType:'text/plain',source:'test'});
const headers={'Content-Type':'application/json','X-Device-Id':randomUUID(),'X-Protocol-Version':PROTOCOL_VERSION,'X-App-Version':APP_VERSION};
const reminder=():Reminder=>({id:randomUUID(),noteId:null,title:'Дело',body:'Исходные подробности',remindAt:new Date(Date.now()+3600000).toISOString(),timezone:'Europe/Moscow',status:'PENDING',version:1,createdAt:'2026-09-06T09:00:00Z',updatedAt:'2026-09-06T09:00:00Z'});

describe('RAW and server durability',()=>{
  it('returns 201 then 200 with one RAW and one event',async()=>{
    const {app,store}=setup();const input=note();
    const first=await app.request('/api/v1/notes',{method:'POST',headers,body:JSON.stringify(input)});
    const second=await app.request('/api/v1/notes',{method:'POST',headers,body:JSON.stringify(input)});
    expect(first.status).toBe(201);expect(second.status).toBe(200);
    expect(store.listNotes()).toHaveLength(1);expect(store.getNote(input.id)?.text).toBe(input.text);expect(store.sync(0).events).toHaveLength(1);
  });
  it('rejects changed RAW under the same UUID and protects SQL writes/deletes',async()=>{
    const {app,store}=setup();const input=note();store.putNote(input);
    const response=await app.request('/api/v1/notes',{method:'POST',headers,body:JSON.stringify({...input,text:'changed'})});
    expect(response.status).toBe(409);expect(store.getNote(input.id)?.text).toBe(input.text);
    expect(()=>store.db.prepare('UPDATE raw_notes SET text=? WHERE id=?').run('lost',input.id)).toThrow('RAW is immutable');
    expect(()=>store.db.prepare('DELETE FROM raw_notes WHERE id=?').run(input.id)).toThrow();
  });
  it('rolls back RAW when event write fails',()=>{
    const {store}=setup();store.db.exec("CREATE TRIGGER fail_event BEFORE INSERT ON sync_events BEGIN SELECT RAISE(ABORT, 'disk failure'); END;");
    expect(()=>store.putNote(note())).toThrow('disk failure');expect(store.listNotes()).toHaveLength(0);
  });
  it('survives closing and reopening SQLite',()=>{
    const directory=mkdtempSync(join(tmpdir(),'vt-storage-'));temporary.push(directory);const path=join(directory,'db.sqlite');
    const first=new SqliteStore(path);const input=note();first.putNote(input);first.close();
    const second=new SqliteStore(path);stores.push(second);expect(second.getNote(input.id)?.text).toBe(input.text);expect(second.putNote(input).created).toBe(false);
  });
  it('rejects protocol mismatch, body overflow, and unsafe paths',async()=>{
    const {app}=setup();
    expect((await app.request('/api/v1/notes',{headers:{...headers,'X-Protocol-Version':'99'}})).status).toBe(426);
    expect((await app.request('/api/v1/notes',{method:'POST',headers,body:JSON.stringify({...note(),text:'x'.repeat(600000)})})).status).toBe(413);
    expect((await app.request('/api/v1/sync/ack',{method:'POST',headers,body:JSON.stringify({cursor:0,notes:[{id:randomUUID(),path:'../outside.md'}]})})).status).toBe(400);
  });
  it('marks a conflicting vault copy for review without changing the original',()=>{
    const {store}=setup();const input=note();store.putNote(input);const deviceId=randomUUID();store.addDevice(deviceId,'PC','desktop');
    store.acknowledge(deviceId,1,[{id:input.id,path:'Conflicts/'+input.id+'.md'}]);
    expect(store.getNote(input.id)?.status).toBe('NEEDS_REVIEW');expect(store.getNote(input.id)?.text).toBe(input.text);
    store.acknowledge(deviceId,1,[{id:input.id,path:'Conflicts/'+input.id+'.md'}]);expect(store.sync(0).events).toHaveLength(2);
  });
});
describe('offline outbox',()=>{
  it('stores a user title as a RAW Markdown heading before queuing',async()=>{
    const {database}=setup();const id=await saveNote('Подробности без изменения\n','План ролика',database);
    const saved=await database.notes.get(id);const queued=await database.queue.where('entityId').equals(id).first();
    expect(saved?.text).toBe('# План ролика\n\nПодробности без изменения\n');
    expect((queued?.payload as NoteInput).text).toBe(saved?.text);
  });
  it('keeps ten exact originals over a database close and replays after reconnection',async()=>{
    const {database,store,fetcher}=setup();const texts=Array.from({length:10},(_,i)=>`  Мысль ${i}\n🧠\r\n`);
    for(const text of texts)await saveNote(text,database);
    await syncNow(database,async()=>{throw new TypeError('offline');});
    expect(await database.queue.count()).toBe(10);database.close();await database.open();
    expect((await database.notes.toArray()).map(n=>n.text).sort()).toEqual([...texts].sort());
    await syncNow(database,fetcher,true);
    expect(await database.queue.count()).toBe(0);expect(store.listNotes()).toHaveLength(10);
    expect(store.listNotes().map(n=>n.text).sort()).toEqual([...texts].sort());
  });
  it('retries an upload whose ACK was lost without duplicating the note',async()=>{
    const {database,store,fetcher}=setup();await saveNote('ACK loss',database);
    let loseAck=true;
    await syncNow(database,async(input,init)=>{
      const response=await fetcher(input,init);
      if(String(input).endsWith('/notes')&&loseAck){loseAck=false;throw new TypeError('connection dropped after COMMIT');}
      return response;
    });
    expect(store.listNotes()).toHaveLength(1);expect(await database.queue.count()).toBe(1);
    await syncNow(database,fetcher,true);expect(store.listNotes()).toHaveLength(1);expect(await database.queue.count()).toBe(0);
  });
  it('does not acknowledge a local save if queue insertion fails',async()=>{
    const {database}=setup();await getSettings(database);
    const hook=()=>{throw new Error('quota exceeded');};database.queue.hook('creating',hook);
    await expect(saveNote('do not claim saved',database)).rejects.toThrow('quota exceeded');
    expect(await database.notes.count()).toBe(0);database.queue.hook('creating').unsubscribe(hook);
  });
  it('exports offline queue and preserves blocked RAW conflicts',async()=>{
    const {database,store,fetcher}=setup();const id=await saveNote('local original',database);const local=await database.notes.get(id);
    store.putNote({...local!,text:'remote original'});
    await syncNow(database,fetcher,true);
    expect((await database.queue.toArray())[0].blocked).toBe(true);
    const exported=await exportData(database);expect(exported.notes[0].text).toBe('local original');expect(exported.queue).toHaveLength(1);expect(store.getNote(id)?.text).toBe('remote original');
  });
});
describe('voice draft',()=>{
  it('adds dictated text to the editable draft without saving it',()=>{
    expect(appendVoiceText('Первая строка','Вторая строка')).toBe('Первая строка\nВторая строка');
    expect(appendVoiceText('','  Голосовая мысль  ')).toBe('Голосовая мысль');
  });
});
describe('reminders and optimistic concurrency',()=>{
  it('queues create, snooze, done offline and retries the entire chain safely',async()=>{
    const {database,store,fetcher}=setup();const initial=reminder();
    const first=await saveReminder(initial,database);
    const snoozed=await saveReminder({...first,status:'SNOOZED',remindAt:new Date(Date.now()+7200000).toISOString()},database);
    await saveReminder({...snoozed,status:'DONE'},database);
    await syncNow(database,fetcher,true);
    expect(await database.queue.count()).toBe(0);expect(store.getReminder(first.id)?.status).toBe('DONE');expect(store.getReminder(first.id)?.version).toBe(3);
  });
  it('replays identical mutation once and rejects stale edits',()=>{
    const {store}=setup();const input={operationId:randomUUID(),baseVersion:0,reminder:reminder()};
    store.mutateReminder(input);store.mutateReminder(input);expect(store.sync(0).events).toHaveLength(1);
    const edit={operationId:randomUUID(),baseVersion:1,reminder:{...input.reminder,version:2,status:'DONE' as const}};
    store.mutateReminder(edit);
    expect(()=>store.mutateReminder({...edit,operationId:randomUUID(),reminder:{...edit.reminder,title:'lost edit'}})).toThrow('другом устройстве');
  });
  it('keeps conflicting local reminder and offers a separate preserved copy',async()=>{
    const {database,store,fetcher}=setup();const local=await saveReminder(reminder(),database);await syncNow(database,fetcher,true);
    store.mutateReminder({operationId:randomUUID(),baseVersion:1,reminder:{...local,title:'На другом устройстве',version:2}});
    await saveReminder({...local,title:'Локальная версия'},database);await syncNow(database,fetcher,true);
    expect((await database.reminders.get(local.id))?.title).toBe('Локальная версия');expect((await database.queue.toArray())[0].blocked).toBe(true);
    await preserveReminderConflict(local.id,database);await syncNow(database,fetcher,true);
    expect(store.listReminders()).toHaveLength(2);expect((await exportData(database)).recovery).toHaveLength(1);
    expect((await database.reminders.get(local.id))?.title).toBe('На другом устройстве');
  });
});
describe('device authentication',()=>{
  it('hashes tokens, creates HttpOnly sessions and revokes access',async()=>{
    const {app,store}=setup(true,true);const token='test-secret-token-that-is-long-enough';const id=randomUUID();store.addDevice(id,'Phone','client',token);
    const row=store.db.prepare('SELECT token_hash FROM devices WHERE id=?').get(id);expect(row?.token_hash).not.toBe(token);
    expect((await app.request('/api/v1/notes',{headers})).status).toBe(401);
    const pairing=await app.request('/api/v1/session',{method:'POST',headers,body:JSON.stringify({token})});
    expect(pairing.status).toBe(200);expect(pairing.headers.get('set-cookie')).toContain('HttpOnly');expect(pairing.headers.get('set-cookie')).toContain('Secure');expect(pairing.headers.get('set-cookie')).toContain('SameSite=None');
    const authenticated={...headers,Cookie:pairing.headers.get('set-cookie')!.split(';')[0]};
    expect((await app.request('/api/v1/notes',{headers:authenticated})).status).toBe(200);
    store.revokeDevice(id);expect((await app.request('/api/v1/notes',{headers:authenticated})).status).toBe(401);
  });
});

describe('Vercel request bridge',()=>{
  it('accepts Vercel pre-parsed JSON and persists the exact RAW note',async()=>{
    const {app,store}=setup(); const input=note();
    const request=Object.assign(Readable.from([]),{
      method:'POST',url:'/api/v1/notes',body:input,
      headers:{host:'localhost','content-type':'application/json','x-device-id':randomUUID(),'x-protocol-version':PROTOCOL_VERSION,'x-app-version':APP_VERSION},
    });
    const result:{statusCode?:number;headers:Record<string,string>;body?:Buffer}={headers:{}};
    const response={
      setHeader(name:string,value:string) { result.headers[name]=value; },
      end(body:Buffer) { result.body=body; },
      set statusCode(value:number) { result.statusCode=value; },
      get statusCode() { return result.statusCode ?? 200; },
    };
    await forwardVercelRequest(app.fetch.bind(app),request as never,response as never);
    expect(result.statusCode).toBe(201); expect(JSON.parse(result.body!.toString()).note.text).toBe(input.text);
    expect(store.getNote(input.id)?.text).toBe(input.text);
  });
});
