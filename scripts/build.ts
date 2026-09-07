import {build as viteBuild} from 'vite';
import {build} from 'esbuild';
await viteBuild();
await build({entryPoints:['apps/server/src/index.ts'],outfile:'dist/server.mjs',bundle:true,platform:'node',format:'esm',packages:'external',target:'node24'});
await build({entryPoints:['apps/server/src/vercel.ts'],outfile:'dist/vercel.mjs',bundle:true,platform:'node',format:'esm',packages:'external',target:'node24'});
await build({entryPoints:['apps/desktop-sync/src/index.ts'],outfile:'dist/desktop-sync.mjs',bundle:true,platform:'node',format:'esm',packages:'external',target:'node24'});
