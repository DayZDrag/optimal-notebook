import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.vaultterminal.notebook',
  appName: 'Vault Terminal',
  webDir: 'dist/web',
  android: { path: 'apps/android', backgroundColor: '#101410' },
  server: { androidScheme: 'https', hostname: 'localhost', cleartext: false },
};
export default config;
