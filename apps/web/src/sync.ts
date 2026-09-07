import { db, getSettings, type VaultDB, type QueueItem } from './db';
import { APP_VERSION, PROTOCOL_VERSION, type Note, type Reminder, type ReminderMutation, type SyncPage } from '../../../packages/shared/src/index';

export class ApiError extends Error {
  constructor(message:string,public status:number,public current?:unknown) { super(message); }
}
export const retryDelay=(attempt:number,random=Math.random)=>Math.min([1000,2000,5000,10000,30000,60000][attempt-1] ?? 300000,300000)*(0.8+random()*0.4);
export async function api<T>(path:string,init:RequestInit={},database=db,fetcher:typeof fetch=fetch):Promise<T> {
  const settings=await getSettings(database);
  const response=await fetcher(settings.serverUrl+path,{...init,credentials:'include',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json','X-Protocol-Version':PROTOCOL_VERSION,'X-App-Version':APP_VERSION,'X-Device-Id':settings.deviceId,...init.headers}});
  const body=await response.json().catch(()=>({error:'Сервер вернул некорректный ответ'}));
  if (!response.ok) throw new ApiError(body.error ?? `HTTP ${response.status}`,response.status,body.current);
  return body as T;
}
const running=new WeakMap<VaultDB,Promise<void>>();
export function syncNow(database=db,fetcher:typeof fetch=fetch,force=false):Promise<void> {
  const current=running.get(database); if(current) return current;
  const run=async()=>{
    // Web Locks serializes tabs and the service worker. Idempotency is still required after crashes.
    const work=()=>runSync(database,fetcher,force);
    if (typeof navigator !== 'undefined' && navigator.locks) await navigator.locks.request('vault-terminal-sync',work);
    else await work();
  };
  const promise=run().finally(()=>running.delete(database)); running.set(database,promise); return promise;
}
async function runSync(database:VaultDB,fetcher:typeof fetch,force:boolean) {
  await database.meta.put({key:'syncing',value:Date.now()});
  try {
    const queue=await database.queue.orderBy('seq').toArray();
    const stopped=new Set<string>(); let firstError:string|undefined;
    for(const item of queue) {
      if(stopped.has(item.entityId)) continue;
      if(item.blocked || (!force && item.nextAttemptAt>Date.now())) {stopped.add(item.entityId);continue;}
      try {
        if(item.entityType==='note') {
          const result=await api<{note:Note}>('/api/v1/notes',{method:'POST',body:JSON.stringify(item.payload)},database,fetcher);
          if(result.note.id!==item.entityId || result.note.text!==(item.payload as Note).text) throw new Error('ACK не соответствует отправленному RAW');
          await database.transaction('rw',database.notes,database.queue,async()=>{
            const local=await database.notes.get(item.entityId);
            await database.notes.put({...result.note,archived:local?.archived}); await database.queue.delete(item.seq!);
          });
        } else {
          const payload=item.payload as ReminderMutation;
          const path='/api/v1/reminders'+(payload.baseVersion ? '/'+item.entityId : '');
          const result=await api<{reminder:Reminder}>(path,{method:payload.baseVersion ? (payload.reminder.status==='CANCELLED'?'DELETE':'PATCH') : 'POST',body:JSON.stringify(payload)},database,fetcher);
          if(result.reminder.id!==item.entityId || result.reminder.version!==payload.reminder.version) throw new Error('Некорректный ACK напоминания');
          await database.transaction('rw',database.reminders,database.queue,async()=>{
            const newer=await database.queue.where('entityId').equals(item.entityId).filter(q=>q.seq!>item.seq!).count();
            if(!newer) await database.reminders.put(result.reminder);
            await database.queue.delete(item.seq!);
          });
        }
      } catch(error) {
        const message=error instanceof Error ? error.message : 'Сеть недоступна';
        const blocked=error instanceof ApiError && [400,403,409,413,426].includes(error.status);
        await database.transaction('rw',database.queue,database.notes,async()=>{
          await database.queue.update(item.seq!,{attempts:item.attempts+1,nextAttemptAt:Date.now()+retryDelay(item.attempts+1),error:message,blocked,conflict:error instanceof ApiError ? error.current : undefined});
          if(item.entityType==='note') await database.notes.update(item.entityId,{status:'SYNC_ERROR'});
        });
        stopped.add(item.entityId); firstError ??= message;
        if(!(error instanceof ApiError) || [401,429,500,502,503,504].includes(error.status)) break;
      }
    }
    let page:SyncPage;
    const settings=await getSettings(database);
    const cursorKey='cursor:'+settings.serverUrl;
    do {
      const cursor=String((await database.meta.get(cursorKey))?.value ?? '0');
      page=await api<SyncPage>('/api/v1/sync?cursor='+encodeURIComponent(cursor),{},database,fetcher);
      if(!Array.isArray(page.events) || !/^\d+$/.test(page.nextCursor) || Number(page.nextCursor)<Number(cursor)) throw new Error('Некорректная страница синхронизации');
      await database.transaction('rw',database.notes,database.reminders,database.queue,database.meta,async()=>{
        for(const event of page.events) {
          const pending=await database.queue.where('entityId').equals(event.entityId).count();
          if(pending) continue; // Never overwrite an unsent local version with a remote event.
          if(event.entityType==='note') {
            const existing=await database.notes.get(event.entityId); const incoming=event.payload as Note;
            if(existing && existing.text!==incoming.text) {
              await database.meta.put({key:'conflict:'+event.entityId,value:{local:existing,remote:incoming}});
              throw new Error('Конфликт RAW: синхронизация остановлена, версии сохранены на устройствах');
            }
            await database.notes.put({...incoming,archived:existing?.archived});
          } else {
            const existing=await database.reminders.get(event.entityId); const incoming=event.payload as Reminder;
            if(!existing || incoming.version>existing.version) await database.reminders.put(incoming);
          }
        }
        await database.meta.put({key:cursorKey,value:page.nextCursor});
      });
    } while(page.hasMore);
    await api('/api/v1/sync/ack',{method:'POST',body:JSON.stringify({cursor:page.nextCursor})},database,fetcher);
    await database.meta.put({key:'lastSync',value:new Date().toISOString()});
    await database.meta.put({key:'syncError',value:firstError ?? ''});
  } catch(error) {
    await database.meta.put({key:'syncError',value:error instanceof Error ? error.message : 'Сеть недоступна'});
  } finally { await database.meta.delete('syncing'); }
}
export async function scheduleSync() {
  void syncNow();
  if('serviceWorker' in navigator) {
    const registration=await navigator.serviceWorker.getRegistration();
    const sync=(registration as (ServiceWorkerRegistration & {sync?:{register(tag:string):Promise<void>}})|undefined)?.sync;
    if(sync) await sync.register('vault-terminal-sync').catch(()=>{});
  }
}
