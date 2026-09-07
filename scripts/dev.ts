export {};
process.env.VT_EMBEDDED='1';
const {startServer}=await import('../apps/server/src/index');
const {createServer}=await import('vite');
const {server}=startServer();
const vite=await createServer(); await vite.listen(); vite.printUrls();
process.once('SIGINT',()=>{void vite.close();server.close();});
process.once('SIGTERM',()=>{void vite.close();server.close();});
