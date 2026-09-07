import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { SqliteStore } from '../packages/db/src/store';
if(existsSync('.env')) loadEnvFile('.env');
const store=new SqliteStore(process.env.DATABASE_PATH);
const [command,...args]=process.argv.slice(2).filter(a=>a!=='--');
if(command==='add') {
  const id=randomUUID(); const token=randomBytes(32).toString('base64url');
  const role=args.includes('--desktop')?'desktop':'client';
  const name=args.find(a=>!a.startsWith('--')) ?? (role==='desktop'?'ПК':'Телефон');
  store.addDevice(id,name,role,token);
  console.log(`Устройство: ${name}\nID: ${id}\nРоль: ${role}\nОдноразовый показ токена: ${token}\nСохраните токен в менеджере паролей. На сервере хранится только SHA-256.`);
} else if(command==='revoke' && args[0]) {store.revokeDevice(args[0]);console.log('Устройство и его сессии отозваны.');}
else {console.error('device:add -- Имя [--desktop] | device:revoke -- UUID');process.exitCode=1;}
store.close();
