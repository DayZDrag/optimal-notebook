import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { MAX_VAULT_FILE_BYTES, safeVaultMarkdownPath, type VaultFileInput } from '../../../packages/shared/src/index';

export interface VaultScanResult { files: VaultFileInput[]; skipped: number; }

function staysInside(root:string, candidate:string) {
  const path=relative(root,candidate);
  return path==='' || (path!=='..' && !path.startsWith('..'+sep));
}

/**
 * The mirror deliberately only contains user Markdown. Obsidian settings, plugin
 * credentials, caches, links and oversized files never leave the computer.
 */
export async function scanVaultMarkdown(root:string):Promise<VaultScanResult> {
  const canonical=await realpath(root);const files:VaultFileInput[]=[];let skipped=0;
  const visit=async (directory:string, relativeDirectory:string):Promise<void> => {
    for(const entry of await readdir(directory,{withFileTypes:true})) {
      if(entry.name.startsWith('.') || entry.name==='node_modules') { skipped++;continue; }
      const absolute=join(directory,entry.name);const path=relativeDirectory ? relativeDirectory+'/'+entry.name : entry.name;
      const info=await lstat(absolute);
      if(info.isSymbolicLink()) { skipped++;continue; }
      const actual=await realpath(absolute);
      if(!staysInside(canonical,actual)) { skipped++;continue; }
      if(info.isDirectory()) { await visit(actual,path);continue; }
      if(!info.isFile() || !safeVaultMarkdownPath(path)) { if(info.isFile())skipped++;continue; }
      if(info.size>MAX_VAULT_FILE_BYTES) { skipped++;continue; }
      const content=await readFile(actual,'utf8');
      if(Buffer.byteLength(content,'utf8')>MAX_VAULT_FILE_BYTES) { skipped++;continue; }
      files.push({path,content,sha256:createHash('sha256').update(content,'utf8').digest('hex'),modifiedAt:info.mtime.toISOString()});
    }
  };
  await visit(canonical,'');
  files.sort((a,b)=>a.path.localeCompare(b.path,'ru'));
  return {files,skipped};
}
