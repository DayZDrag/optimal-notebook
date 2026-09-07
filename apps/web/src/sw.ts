/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { clientsClaim } from 'workbox-core';
import { syncNow } from './sync';
import { db } from './db';
declare const self: ServiceWorkerGlobalScope & {__WB_MANIFEST: {url:string;revision:string}[]};
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'),{denylist:[/^\/api\//]}));
clientsClaim();
// The new version waits until old tabs close; no forced reload while composing.
self.addEventListener('sync', (event: Event & {tag?:string;waitUntil?: (promise:Promise<unknown>)=>void})=>{
  if(event.tag==='vault-terminal-sync') event.waitUntil?.(syncNow().then(async()=>{
    if(await db.queue.filter(item=>!item.blocked).count()) throw new Error('Очередь ожидает повторной отправки');
  }));
});
self.addEventListener('notificationclick', event=>{
  event.notification.close();
  event.waitUntil(self.clients.matchAll({type:'window'}).then(async clients=>{
    if(clients[0]) { await clients[0].focus(); clients[0].postMessage({type:'show-reminders'}); }
    else await self.clients.openWindow('/#reminders');
  }));
});
