import { PostgresStore, SqliteStore } from '../packages/db/src/store';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
if(existsSync('.env')) loadEnvFile('.env');
const store=process.env.DATABASE_URL ? new PostgresStore(process.env.DATABASE_URL) : new SqliteStore(process.env.DATABASE_PATH);
await store.putNote({id:'4ebd0da6-51da-49e4-a44f-92b1a0f41322',deviceId:'ad50943e-88f6-427c-80ea-e26b4372e3aa',text:'Добро пожаловать в Vault Terminal.\n\nСначала запишите мысль. К организации можно вернуться позже.',clientCreatedAt:'2026-09-06T08:00:00.000Z',contentType:'text/plain',source:'dev-seed'});
await store.close(); console.log('Демонстрационная заметка добавлена. Повторный seed не создаёт дублей.');
