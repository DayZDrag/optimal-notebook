import { createApp } from '../apps/server/src/app';
import { PostgresStore } from '../packages/db/src/store';

const databaseUrl=process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('Для Vercel требуется DATABASE_URL от Neon.');

const origins=(process.env.WEB_ORIGIN ?? '').split(',').map(value=>value.trim()).filter(Boolean);
if (!origins.length || origins.some(origin=>!origin.startsWith('https://'))) throw new Error('Для Vercel задайте WEB_ORIGIN только из HTTPS origins, включая https://localhost для APK.');

const globalStore=globalThis as typeof globalThis & {vaultTerminalStore?: PostgresStore};
const store=globalStore.vaultTerminalStore ??= new PostgresStore(databaseUrl);
const app=createApp(store,{authRequired:true,origin:origins,secureCookies:true});

export default app.fetch;
