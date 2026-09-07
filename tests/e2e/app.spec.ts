import { test,expect,chromium,type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

async function ready(page:Page) {
  await page.goto('/');await expect(page.getByRole('heading',{name:'Освободите голову.'})).toBeVisible();
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);
}
async function capture(page:Page,text:string) {
  await page.getByLabel('Что сейчас в голове?').fill(text);await page.getByRole('button',{name:'Сохранить мысль',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Сохранено локально');
  await expect(page.getByLabel('Что сейчас в голове?')).toHaveValue('');
}
async function serverNotes(page:Page) {
  return page.evaluate(async()=>{
    const response=await fetch('/api/v1/notes',{headers:{'X-Protocol-Version':'1','X-App-Version':'0.1.0','X-Device-Id':'0164d442-84e1-4f15-943c-ced0ddbe8ac7'}});
    return (await response.json()).notes as {id:string;text:string}[];
  });
}
test('PWA captures ten notes offline, restarts the browser and syncs all originals once',async({browserName})=>{
  expect(browserName).toBe('chromium');
  const profile=resolve('.test-data/profile-'+randomUUID());await mkdir(profile,{recursive:true});
  const options={channel:process.env.PLAYWRIGHT_CHANNEL ?? 'msedge',headless:true,baseURL:'http://localhost:8799',viewport:{width:1280,height:900}};
  let context=await chromium.launchPersistentContext(profile,options);
  let page=context.pages()[0];const prefix=randomUUID();
  const texts=Array.from({length:10},(_,i)=>`${prefix} мысль ${i}\n  Оригинал 🐝  `);
  try {
    await ready(page);await context.setOffline(true);
    for(const text of texts)await capture(page,text);
    await context.close();
    context=await chromium.launchPersistentContext(profile,options);await context.setOffline(true);
    page=context.pages()[0];await page.goto('http://localhost:8799/');
    await expect(page.getByRole('heading',{name:'Освободите голову.'})).toBeVisible();
    await page.getByRole('button',{name:'Все записи',exact:true}).click();
    await expect(page.locator('.note-row').filter({hasText:prefix})).toHaveCount(10);
    await context.setOffline(false);
    await expect.poll(async()=>(await serverNotes(page)).filter(n=>n.text.startsWith(prefix)).length).toBe(10);
    const stored=(await serverNotes(page)).filter(n=>n.text.startsWith(prefix));
    expect(stored.map(n=>n.text).sort()).toEqual([...texts].sort());
    await page.reload();expect((await serverNotes(page)).filter(n=>n.text.startsWith(prefix))).toHaveLength(10);
  } finally {await context.close();}
});
test('a lost upload ACK retains the queue then retries without a duplicate',async({page})=>{
  await ready(page);let lost=false;const text='lost-ack-'+randomUUID();
  await page.route('**/api/v1/notes',async route=>{
    if(route.request().method()==='POST'&&!lost){lost=true;await route.fetch();await route.abort('failed');}else await route.continue();
  });
  await capture(page,text);await expect.poll(()=>lost).toBe(true);
  await page.getByRole('button',{name:'Состояние синхронизации',exact:true}).click();
  await expect(page.locator('.queue-error')).toBeVisible();
  await page.getByRole('button',{name:'Синхронизировать сейчас',exact:true}).click();
  await expect(page.locator('.queue-error')).toHaveCount(0);
  expect((await serverNotes(page)).filter(n=>n.text===text)).toHaveLength(1);
});
test('server downtime does not block save and offline export preserves RAW',async({page,context})=>{
  await ready(page);await context.setOffline(true);const text='export-'+randomUUID()+'\n  original  ';
  await capture(page,text);await page.getByRole('button',{name:'Настройки',exact:true}).click();
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Скачать JSON'}).click();const download=await downloadPromise;
  const stream=await download.createReadStream();const chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));const exported=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  expect(exported.notes.find((n:{text:string})=>n.text===text)).toBeTruthy();expect(exported.queue.some((q:{payload:{text:string}})=>q.payload.text===text)).toBe(true);
});
test('reminder creation, overdue, snooze and done persist through reload',async({page})=>{
  await ready(page);await page.getByRole('button',{name:'Напоминания',exact:true}).click();await page.getByRole('button',{name:'Напоминание',exact:true}).click();
  const title='reminder-'+randomUUID();await page.getByLabel('О чём напомнить').fill(title);await page.getByLabel('Когда', {exact:true}).fill('2026-01-01T09:00');await page.getByRole('button',{name:'Сохранить напоминание'}).click();
  const card=page.locator('.reminder-card').filter({hasText:title});await expect(card).toBeVisible();
  await page.getByLabel('Отложить: '+title,{exact:true}).selectOption('60');await expect(card.locator('.overdue')).toHaveCount(0);
  await page.getByRole('button',{name:'Отметить выполненным: '+title,exact:true}).click();await expect(card).toHaveCount(0);
  await page.reload();await page.getByRole('button',{name:'Напоминания',exact:true}).click();await page.getByRole('button',{name:'Готово',exact:true}).click();await expect(card).toBeVisible();
});
test('mobile layout, text search and saved theme work',async({page})=>{
  await page.setViewportSize({width:390,height:844});await ready(page);const text='Мобильная мысль '+randomUUID();await capture(page,text);
  await page.getByRole('button',{name:'Открыть меню'}).click();await page.getByRole('button',{name:'Найти в записях'}).click();await page.getByLabel('Поиск по заметкам').fill(text);await expect(page.locator('.note-row').filter({hasText:text})).toBeVisible();
  await page.getByRole('button',{name:'Открыть меню'}).click();await page.getByRole('button',{name:'Настройки',exact:true}).click();await page.getByRole('button',{name:'Светлая',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme','classic-light');await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','classic-light');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/mobile-light.png',fullPage:true});
});
test('desktop terminal renders without browser errors and has an install manifest',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await ready(page);
  const manifest=await page.request.get('/manifest.webmanifest');expect(manifest.ok()).toBe(true);expect((await manifest.json()).display).toBe('standalone');
  expect((await page.request.get('/icon-192.png')).ok()).toBe(true);
  await page.screenshot({path:'test-results/desktop-terminal.png',fullPage:true});expect(errors).toEqual([]);
});
