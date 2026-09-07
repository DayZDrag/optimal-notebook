import { defineConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';
export default defineConfig({
  testDir:'tests/e2e',fullyParallel:false,workers:1,timeout:60000,
  expect:{timeout:15000},reporter:'list',
  use:{baseURL:'http://localhost:8799',channel:process.env.PLAYWRIGHT_CHANNEL ?? 'msedge',headless:true,trace:'retain-on-failure',screenshot:'only-on-failure'},
  webServer:{command:'node dist/server.mjs',url:'http://localhost:8799/api/health',reuseExistingServer:false,timeout:30000,env:{PORT:'8799',HOST:'127.0.0.1',WEB_ORIGIN:'http://localhost:8799',DATABASE_PATH:'.test-data/e2e-'+randomUUID()+'.sqlite',AUTH_REQUIRED:'false',NODE_ENV:'test'}},
});
