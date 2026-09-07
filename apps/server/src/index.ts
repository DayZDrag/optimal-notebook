import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import { SqliteStore } from '../../../packages/db/src/store';
import { createApp } from './app';

if (existsSync('.env')) loadEnvFile('.env');
export function startServer() {
  const authRequired=process.env.AUTH_REQUIRED === 'true';
  const host=process.env.HOST ?? '127.0.0.1';
  const origins=(process.env.WEB_ORIGIN ?? 'http://localhost:5173').split(',').map(origin=>origin.trim()).filter(Boolean);
  const production=process.env.NODE_ENV === 'production';
  if (!authRequired && (!['127.0.0.1','localhost','::1'].includes(host) || production)) throw new Error('Без авторизации сервер разрешён только на loopback в dev-режиме');
  if (production && (!origins.length || origins.some(origin=>!origin.startsWith('https://')))) throw new Error('В production требуется WEB_ORIGIN=https://... и HTTPS reverse proxy');
  const store=new SqliteStore(process.env.DATABASE_PATH);
  const app=createApp(store,{authRequired,origin:origins,secureCookies:production});
  app.use('*',async(c,next)=>{
    c.header('X-Content-Type-Options','nosniff');
    c.header('Referrer-Policy','no-referrer');
    c.header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; worker-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
    await next();
  });
  app.use('*',serveStatic({root:'./dist/web'}));
  app.get('/api/*',c=>c.json({error:'Маршрут не найден'},404));
  app.get('*',serveStatic({path:'./dist/web/index.html'}));
  const server=serve({fetch:app.fetch,hostname:host,port:Number(process.env.PORT ?? 8787)},info=>console.log(`Vault Terminal API: http://${host}:${info.port}`));
  const close=()=>server.close(()=>store.close());
  process.once('SIGINT',close); process.once('SIGTERM',close);
  return {server,store};
}
if (!process.env.VT_EMBEDDED) startServer();
