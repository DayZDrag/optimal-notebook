import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { Pool } from 'pg';

if(existsSync('.env'))loadEnvFile('.env');
const connectionString=process.env.DATABASE_URL;
if(!connectionString)throw new Error('DATABASE_URL не задан. Добавьте его временно в .env или выполните SQL из packages/db/migrations/002_vault_mirror.sql в Neon.');
const pool=new Pool({connectionString,ssl:connectionString.includes('localhost') ? false : {rejectUnauthorized:true},max:1});
try {
  await pool.query(await readFile('packages/db/migrations/002_vault_mirror.sql','utf8'));
  console.log(JSON.stringify({operation:'vault_mirror_migration',status:'applied'}));
} finally { await pool.end(); }
