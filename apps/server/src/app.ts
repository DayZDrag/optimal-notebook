import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { getCookie, setCookie } from 'hono/cookie';
import { randomBytes } from 'node:crypto';
import { z, ZodError } from 'zod';
import { ConflictError, type Device, type StorageAdapter } from '../../../packages/db/src/store';
import { idSchema, noteInputSchema, PROTOCOL_VERSION, reminderMutationSchema, safeVaultPath } from '../../../packages/shared/src/index';

export interface ServerOptions { authRequired: boolean; origin: string | string[]; secureCookies?: boolean }
export function createApp(store: StorageAdapter, options: ServerOptions) {
  const app = new Hono<{Variables: {device: Device}}>();
  const rates = new Map<string, {count: number; reset: number}>();
  const origins=Array.isArray(options.origin) ? options.origin : [options.origin];
  app.use('/api/*', cors({origin: origins, credentials: true, allowHeaders: ['Content-Type','Authorization','X-Protocol-Version','X-App-Version','X-Device-Id','X-Device-Role'], allowMethods: ['GET','POST','PATCH','DELETE','OPTIONS']}));
  app.use('/api/*', bodyLimit({maxSize: 512*1024, onError: c => c.json({error: 'Запрос превышает 512 КБ'}, 413)}));
  app.use('/api/*', async (c, next) => {
    c.header('Cache-Control','no-store'); c.header('X-Content-Type-Options','nosniff');
    const requestUrl=new URL(c.req.url);
    if(!options.authRequired && !['localhost','127.0.0.1','[::1]'].includes(requestUrl.hostname)) return c.json({error:'Локальный сервер принимает только localhost'},403);
    const origin=c.req.header('Origin');
    const localSameOrigin=!options.authRequired && origin===requestUrl.origin;
    if (c.req.method !== 'GET' && origin && !origins.includes(origin) && !localSameOrigin) return c.json({error: 'Недопустимый Origin'},403);
    await next();
  });
  app.get('/api/health', c => c.json({ok: true, protocolVersion: PROTOCOL_VERSION, authRequired: options.authRequired}));
  app.use('/api/v1/*', async (c, next) => {
    if (c.req.header('X-Protocol-Version') !== PROTOCOL_VERSION) return c.json({error: 'Несовместимая версия протокола. Обновите приложение.'},426);
    const deviceId = idSchema.safeParse(c.req.header('X-Device-Id'));
    if (!deviceId.success || !c.req.header('X-App-Version')) return c.json({error: 'Нужны deviceId и appVersion'},400);
    // A global pre-auth bucket prevents rotating client-supplied IDs from bypassing this limit.
    const key = c.req.path === '/api/v1/session' ? 'pairing' : 'api';
    if (rates.size > 20) rates.clear();
    const bucket = rates.get(key) ?? {count:0,reset:Date.now()+60000};
    if (bucket.reset < Date.now()) { bucket.count=0; bucket.reset=Date.now()+60000; }
    rates.set(key,bucket);
    if (++bucket.count > (key === 'pairing' ? 20 : 1200)) { c.header('Retry-After','60'); return c.json({error: 'Слишком много запросов. Повторите через минуту.'},429); }
    if (c.req.path === '/api/v1/session' && c.req.method === 'POST') { await next(); return; }
    let device: Device | undefined;
    if (!options.authRequired) {
      await store.addDevice(deviceId.data,'Локальное устройство',c.req.header('X-Device-Role') === 'desktop' ? 'desktop' : 'client');
      device=await store.getDevice(deviceId.data);
    } else {
      const bearer=c.req.header('Authorization')?.match(/^Bearer (.+)$/)?.[1];
      const cookie=getCookie(c,'vt_session');
      device=bearer ? await store.authenticate(bearer) : cookie ? await store.authenticateSession(cookie) : undefined;
    }
    if (!device) return c.json({error: 'Подключите устройство в настройках. Записи сохранены локально.'},401);
    c.set('device',device); await next();
  });
  app.post('/api/v1/session', async c => {
    const {token} = z.object({token:z.string().min(20).max(200)}).parse(await c.req.json());
    const device=await store.authenticate(token);
    if (!device || device.role !== 'client') return c.json({error:'Токен не найден, отозван или предназначен для ПК-агента'},401);
    const session=randomBytes(32).toString('base64url'); await store.addSession(session,device.id);
    // Capacitor runs at https://localhost while production API is a separate HTTPS origin.
    // Its session cookie must opt in to that cross-origin request; CORS and Origin checks above
    // still reject state-changing requests from every origin except the configured application.
    setCookie(c,'vt_session',session,{httpOnly:true,secure:!!options.secureCookies,sameSite:options.secureCookies ? 'None' : 'Strict',path:'/api',maxAge:30*86400});
    return c.json({device:{id:device.id,name:device.name}});
  });
  app.post('/api/v1/notes', async c => {
    const input=noteInputSchema.parse(await c.req.json());
    const result=await store.putNote(input); return c.json(result,result.created ? 201 : 200);
  });
  app.get('/api/v1/notes', async c => c.json({notes:await store.listNotes()}));
  app.get('/api/v1/notes/:id', async c => {
    const note=await store.getNote(idSchema.parse(c.req.param('id')));
    return note ? c.json({note}) : c.json({error:'Заметка не найдена'},404);
  });
  app.get('/api/v1/sync', async c => {
    const cursor=z.coerce.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).parse(c.req.query('cursor') ?? '0');
    return c.json(await store.sync(cursor));
  });
  app.post('/api/v1/sync/ack', async c => {
    const input=z.object({cursor:z.coerce.number().int().nonnegative(),notes:z.array(z.object({id:idSchema,path:z.string().refine(safeVaultPath)})).max(200).default([])}).parse(await c.req.json());
    if (input.notes.length && c.get('device').role !== 'desktop') return c.json({error:'Требуется токен ПК-агента'},403);
    await store.acknowledge(c.get('device').id,input.cursor,input.notes); return c.json({ok:true});
  });
  app.get('/api/v1/reminders', async c => c.json({reminders:await store.listReminders()}));
  app.post('/api/v1/reminders', async c => {
    const input=reminderMutationSchema.parse(await c.req.json());
    if (input.baseVersion !== 0) return c.json({error:'Для новой записи baseVersion должен быть 0'},400);
    const result=await store.mutateReminder(input); return c.json(result,result.created ? 201 : 200);
  });
  app.on(['PATCH','DELETE'],'/api/v1/reminders/:id', async c => {
    const input=reminderMutationSchema.parse(await c.req.json());
    if (input.reminder.id !== c.req.param('id') || input.baseVersion < 1) return c.json({error:'Некорректный ID или baseVersion'},400);
    if (c.req.method === 'DELETE' && input.reminder.status !== 'CANCELLED') return c.json({error:'Удаление должно сохранять CANCELLED'},400);
    const result=await store.mutateReminder(input); return c.json(result);
  });
  app.onError((error,c) => {
    if (error instanceof ZodError || error instanceof SyntaxError) return c.json({error:'Некорректный формат данных', details:error instanceof ZodError ? error.issues.map(i=>({path:i.path.join('.'),message:i.message})) : undefined},400);
    if (error instanceof ConflictError) return c.json({error:error.message,current:error.current},409);
    console.error(JSON.stringify({operation:c.req.method+' '+c.req.routePath,error:error.name}));
    return c.json({error:'Ошибка сервера. Оригинал остаётся в локальной очереди.'},500);
  });
  return app;
}
