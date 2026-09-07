import { PostgresStore } from '../../../packages/db/src/store';
import { createApp } from './app';

const databaseUrl=process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('Для Vercel требуется DATABASE_URL от Neon.');

const origins=(process.env.WEB_ORIGIN ?? '').split(',').map(value=>value.trim()).filter(Boolean);
if (!origins.length || origins.some(origin=>!origin.startsWith('https://'))) throw new Error('Для Vercel задайте WEB_ORIGIN только из HTTPS origins, включая https://localhost для APK.');

const globalStore=globalThis as typeof globalThis & {vaultTerminalStore?: PostgresStore};
// `device:add` initializes the schema before a token can exist. Keeping DDL out of the
// serverless request path avoids a cold start blocking an Android pairing request.
const store=globalStore.vaultTerminalStore ??= new PostgresStore(databaseUrl,{initializeSchema:false,maxConnections:1});

export default createApp(store,{authRequired:true,origin:origins,secureCookies:true});
