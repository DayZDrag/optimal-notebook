import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { APP_VERSION, idSchema, PROTOCOL_VERSION, type Note, type SyncPage } from '../../../packages/shared/src/index';
import { ensureVaultDirectory, ingestNote, readRegular, writeExclusive } from './ingest';
import { scanVaultMarkdown } from './vault-export';

if(existsSync('.env'))loadEnvFile('.env');
export interface DesktopOptions {root:string;serverUrl:string;deviceId:string;token?:string;fetcher?:typeof fetch}
function validateDesktopOptions(options:DesktopOptions) {
  const url=new URL(options.serverUrl);
  if(url.protocol!=='https:' && !(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))throw new Error('Сервер ПК-агента должен использовать HTTPS');
  idSchema.parse(options.deviceId);
}
function desktopRequest(options:DesktopOptions) {
  const fetcher=options.fetcher ?? fetch;
  return async <T>(path:string,init:RequestInit={}):Promise<T>=>{
    const response=await fetcher(options.serverUrl.replace(/\/$/,'')+path,{...init,signal:AbortSignal.timeout(20000),headers:{'Content-Type':'application/json','X-Device-Id':options.deviceId,'X-Device-Role':'desktop','X-Protocol-Version':PROTOCOL_VERSION,'X-App-Version':APP_VERSION,...(options.token?{Authorization:'Bearer '+options.token}:{})}});
    if(!response.ok)throw new Error(`Сервер вернул HTTP ${response.status}`);return response.json() as Promise<T>;
  };
}
export async function syncVault(options:DesktopOptions) {
  validateDesktopOptions(options);
  const stateDirectory=await ensureVaultDirectory(options.root,'.vault-terminal');
  // Each checkpoint is an immutable, uniquely named file. A crash can only replay a page.
  const {readdir}=await import('node:fs/promises');
  let cursor=0;
  for(const name of await readdir(stateDirectory)) {
    if(!/^checkpoint-\d+-[a-f0-9-]+\.json$/.test(name))continue;
    const content=await readRegular(join(stateDirectory,name));
    if(!content)continue;
    const checkpoint=JSON.parse(content) as {serverUrl:string;cursor:number};
    if(checkpoint.serverUrl===options.serverUrl && Number.isSafeInteger(checkpoint.cursor) && checkpoint.cursor>=0)cursor=Math.max(cursor,checkpoint.cursor);
  }
  const request=desktopRequest(options);
  let delivered=0;let conflicts=0;let more=true;
  while(more) {
    const page=await request<SyncPage>('/api/v1/sync?cursor='+cursor);
    const next=Number(page.nextCursor);
    if(!Number.isSafeInteger(next)||next<cursor||!Array.isArray(page.events))throw new Error('Некорректный cursor сервера');
    const acknowledgements:{id:string;path:string}[]=[];
    for(const event of page.events) {
      if(event.entityType!=='note')continue;
      const note=event.payload as Note;
      if(note.status!=='SERVER_RECEIVED')continue;
      const result=await ingestNote(options.root,note);acknowledgements.push(result);delivered++;if(result.conflict)conflicts++;
    }
    await request('/api/v1/sync/ack',{method:'POST',body:JSON.stringify({cursor:next,notes:acknowledgements})});
    if(next>cursor)await writeExclusive(join(stateDirectory,`checkpoint-${next}-${randomUUID()}.json`),JSON.stringify({serverUrl:options.serverUrl,cursor:next,createdAt:new Date().toISOString()}));
    cursor=next;more=page.hasMore;
  }
  return {delivered,conflicts,cursor};
}
/** Upload a revision-preserving Markdown mirror. It never deletes remote copies. */
export async function exportVault(options:DesktopOptions) {
  validateDesktopOptions(options);const scan=await scanVaultMarkdown(options.root);const request=desktopRequest(options);
  let created=0;let unchanged=0;
  for(const file of scan.files) {
    const result=await request<{created:boolean}>('/api/v1/vault/files',{method:'PUT',body:JSON.stringify(file)});
    if(result.created)created++;else unchanged++;
  }
  return {scanned:scan.files.length,created,unchanged,skipped:scan.skipped};
}
async function main() {
  const root=process.env.VAULT_PATH;
  if(!root)throw new Error('Укажите VAULT_PATH в .env. Хранилище не выбирается автоматически.');
  const options:DesktopOptions={root,serverUrl:process.env.SERVER_URL ?? 'http://127.0.0.1:8787',deviceId:process.env.DESKTOP_DEVICE_ID ?? '3b4302aa-cd1a-4bb9-844c-9078e24d05cc',token:process.env.DEVICE_TOKEN};
  const exportOnly=process.argv.includes('--export-vault');
  const run=async()=>{try{console.log(JSON.stringify(exportOnly ? {operation:'vault_export',...await exportVault(options)} : {operation:'vault_sync',...await syncVault(options)}));}catch(error){console.error(JSON.stringify({operation:exportOnly?'vault_export':'vault_sync',error:error instanceof Error?error.message:'failed'}));if(!process.argv.includes('--watch'))process.exitCode=1;}};
  await run();
  if(process.argv.includes('--watch')) {let running=false;setInterval(()=>{if(running)return;running=true;void run().finally(()=>running=false);},15000);}
}
if(!process.env.VT_DESKTOP_EMBEDDED)void main().catch(error=>{console.error(error instanceof Error?error.message:'Не удалось запустить агент');process.exitCode=1;});
