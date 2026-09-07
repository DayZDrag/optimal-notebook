import { mkdir, realpath, lstat, open, readFile, link, unlink, readdir } from 'node:fs/promises';
import { dirname, resolve, relative, sep, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { idSchema, safeVaultPath, type Note } from '../../../packages/shared/src/index';

export async function ensureVaultDirectory(root:string,subdirectory:string) {
  const canonical=await realpath(root);
  let current=canonical;
  for(const part of subdirectory.split('/')) {
    if(!part || part==='.' || part==='..' || /[\\:\x00-\x1f]/.test(part))throw new Error('Недопустимый путь');
    current=join(current,part);
    try {await mkdir(current);} catch(error) {if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
    const info=await lstat(current);
    if(info.isSymbolicLink() || !info.isDirectory())throw new Error('Папка vault не должна быть ссылкой: '+subdirectory);
    const actual=await realpath(current);const rel=relative(canonical,actual);
    if(rel==='..' || rel.startsWith('..'+sep) || resolve(actual)===resolve(canonical))throw new Error('Путь выходит за vault');
  }
  return current;
}
export async function readRegular(path:string) {
  try {
    const info=await lstat(path);
    if(info.isSymbolicLink() || !info.isFile())throw new Error('Вместо обычного файла обнаружена ссылка/каталог');
    return await readFile(path,'utf8');
  } catch(error) {if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}
}
// Link a fully flushed temporary file into its final name with exclusive-create semantics.
// Unlike rename on POSIX, link cannot overwrite another writer's file.
export async function writeExclusive(path:string,content:string) {
  const temp=join(dirname(path),'.vt-'+randomUUID()+'.tmp');
  const handle=await open(temp,'wx');
  try {await handle.writeFile(content,'utf8');await handle.sync();} finally {await handle.close();}
  try {await link(temp,path);} finally {await unlink(temp);}
}
export function noteMarkdown(note:Note) {
  idSchema.parse(note.id);
  return `---\nid: ${JSON.stringify(note.id)}\ncreated: ${JSON.stringify(note.clientCreatedAt)}\nsource: ${JSON.stringify(note.source)}\nraw_note_id: ${JSON.stringify(note.id)}\nai_status: "pending"\n---\n\n${note.text}`;
}
export async function ingestNote(root:string,note:Note):Promise<{id:string;path:string;conflict:boolean}> {
  const markdown=noteMarkdown(note);
  const inbox=await ensureVaultDirectory(root,'00_Inbox');
  const filename=note.id+'.md';const relativePath='00_Inbox/'+filename;
  if(!safeVaultPath(relativePath))throw new Error('Недопустимое имя файла');
  const destination=join(inbox,filename);const existing=await readRegular(destination);
  if(existing===markdown)return {id:note.id,path:relativePath,conflict:false};
  if(existing===undefined) {
    try {await writeExclusive(destination,markdown);return {id:note.id,path:relativePath,conflict:false};}
    catch(error) {if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;return ingestNote(root,note);}
  }
  // A user's edited file is never replaced. The server original gets a deterministic conflict copy.
  const conflicts=await ensureVaultDirectory(root,'Conflicts');
  const names=(await readdir(conflicts)).filter(name=>name.startsWith(note.id+'-raw')&&name.endsWith('.md'));
  for(const name of names)if(await readRegular(join(conflicts,name))===markdown)return {id:note.id,path:'Conflicts/'+name,conflict:true};
  const conflictName=note.id+'-raw-'+randomUUID()+'.md';await writeExclusive(join(conflicts,conflictName),markdown);
  return {id:note.id,path:'Conflicts/'+conflictName,conflict:true};
}
