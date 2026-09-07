import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ingestNote, noteMarkdown } from '../apps/desktop-sync/src/ingest';
import { SqliteStore } from '../packages/db/src/store';
import { createApp } from '../apps/server/src/app';
import type { Note } from '../packages/shared/src/index';
process.env.VT_DESKTOP_EMBEDDED='1';
const {syncVault}=await import('../apps/desktop-sync/src/index');
const paths:string[]=[];const stores:SqliteStore[]=[];
afterEach(async()=>{for(const s of stores.splice(0))s.close();for(const p of paths.splice(0))await rm(p,{recursive:true,force:true});});
async function directory(){const p=await mkdtemp(join(tmpdir(),'vt-desktop-'));paths.push(p);return p;}
const note=():Note=>({id:randomUUID(),deviceId:randomUUID(),text:'  Не менять\r\n\n🐝  ',clientCreatedAt:'2026-09-06T10:00:00Z',contentType:'text/plain',source:'test',status:'SERVER_RECEIVED'});
it('writes exact raw text and produces no duplicate after repeated ingestion',async()=>{
  const root=await directory();const input=note();const first=await ingestNote(root,input);await ingestNote(root,input);
  expect(await readFile(join(root,first.path),'utf8')).toBe(noteMarkdown(input));
  expect(await readdir(join(root,'00_Inbox'))).toHaveLength(1);
});
it('preserves a user edit and stores a single independent raw conflict copy',async()=>{
  const root=await directory();const input=note();const first=await ingestNote(root,input);
  await writeFile(join(root,first.path),'USER EDIT','utf8');const result=await ingestNote(root,input);await ingestNote(root,input);
  expect(result.conflict).toBe(true);expect(await readFile(join(root,first.path),'utf8')).toBe('USER EDIT');
  expect(await readFile(join(root,result.path),'utf8')).toBe(noteMarkdown(input));expect(await readdir(join(root,'Conflicts'))).toHaveLength(1);
});
it('rejects traversal IDs before any file can be written',async()=>{
  const root=await directory();await expect(ingestNote(root,{...note(),id:'../escape'})).rejects.toThrow();expect(await readdir(root)).toHaveLength(0);
});
it('refuses a vault subdirectory junction pointing outside the vault',async()=>{
  const root=await directory();const outside=await directory();await symlink(outside,join(root,'00_Inbox'),'junction');
  await expect(ingestNote(root,note())).rejects.toThrow('ссылкой');expect(await readdir(outside)).toHaveLength(0);
});
it('replays safely after the server commits an ACK but the response is lost',async()=>{
  const root=await directory();const store=new SqliteStore(':memory:');stores.push(store);const app=createApp(store,{authRequired:false,origin:'http://localhost'});const input=note();store.putNote(input);
  let drop=true;
  const fetcher:typeof fetch=async(url,init)=>{const response=await app.request(String(url),init);if(String(url).endsWith('/ack')&&drop){drop=false;throw new Error('ACK lost');}return response;};
  const options={root,deviceId:randomUUID(),serverUrl:'http://localhost',fetcher};
  await expect(syncVault(options)).rejects.toThrow('ACK lost');await syncVault(options);await syncVault(options);
  expect(await readdir(join(root,'00_Inbox'))).toHaveLength(1);expect(store.getNote(input.id)?.status).toBe('VAULT_INBOX');
});
