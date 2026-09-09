import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Clipboard } from '@capacitor/clipboard';
import { ArrowDownToLine, ArrowRight, Archive, Bell, Check, CheckCheck, ChevronRight, CircleHelp, Cloud, CornerDownLeft, FileText, Inbox, Laptop, Menu, Mic, Plus, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Terminal, Wifi, WifiOff, X } from 'lucide-react';
import { db, exportData, getSettings, preserveReminderConflict, saveNote, saveReminder, type Settings } from './db';
import { api, scheduleSync, syncNow } from './sync';
import { exportNativeJson, isNativeAndroid } from './native';
import { APP_VERSION, MAX_NOTE_TITLE, MAX_TEXT, statusLabels, type Note, type Reminder, type VaultSearchResult } from '../../../packages/shared/src/index';
import { appendVoiceText, dictate, voiceInputAvailable } from './voice';

type Page='capture'|'inbox'|'ask'|'reminders'|'settings';
const navigation=[{id:'capture',label:'Записать мысль',icon:Plus},{id:'inbox',label:'Входящие',icon:Inbox},{id:'ask',label:'Найти в записях',icon:Search},{id:'reminders',label:'Напоминания',icon:Bell},{id:'settings',label:'Настройки',icon:Settings2}] as const;
const date=(value:string)=>new Date(value).toLocaleString('ru-RU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const localDate=(value=new Date())=>new Date(value.getTime()-value.getTimezoneOffset()*60000).toISOString().slice(0,16);
const shortId=(id:string)=>id.slice(0,8).toUpperCase();
const errorText=(e:unknown)=>e instanceof Error?e.message:'Не удалось выполнить действие';

export default function App() {
  const [page,setPage]=useState<Page>(location.hash==='#reminders'?'reminders':'capture');
  const [title,setTitle]=useState(''); const [text,setText]=useState(''); const [busy,setBusy]=useState(false); const [recording,setRecording]=useState(false); const [voiceAvailable,setVoiceAvailable]=useState(false);
  const [message,setMessage]=useState(''); const [error,setError]=useState('');
  const [online,setOnline]=useState(navigator.onLine); const [mobileNav,setMobileNav]=useState(false);
  const [syncPanel,setSyncPanel]=useState(false); const [selected,setSelected]=useState<Note>();
  const [reminderEditor,setReminderEditor]=useState<Partial<Reminder>>();
  const [query,setQuery]=useState(''); const [vaultResults,setVaultResults]=useState<VaultSearchResult[]|null>(null); const [vaultSearching,setVaultSearching]=useState(false); const [inboxFilter,setInboxFilter]=useState('all');
  const [reminderFilter,setReminderFilter]=useState('upcoming');
  const [clock,setClock]=useState(Date.now()); const captureRef=useRef<HTMLTextAreaElement>(null);
  const settings=useLiveQuery(()=>db.settings.get('settings'),[]);
  const notes=useLiveQuery(()=>db.notes.orderBy('clientCreatedAt').reverse().toArray(),[]) ?? [];
  const reminders=useLiveQuery(()=>db.reminders.orderBy('remindAt').toArray(),[]) ?? [];
  const queue=useLiveQuery(()=>db.queue.toArray(),[]) ?? [];
  const meta=useLiveQuery(()=>db.meta.toArray(),[]) ?? [];
  const lastSync=meta.find(m=>m.key==='lastSync')?.value as string|undefined;
  const syncError=meta.find(m=>m.key==='syncError')?.value as string|undefined;
  const syncing=Number(meta.find(m=>m.key==='syncing')?.value ?? 0)>clock-60000;
  const activeNotes=notes.filter(n=>!n.archived);
  const due=reminders.filter(r=>['PENDING','SNOOZED','FIRED'].includes(r.status) && new Date(r.remindAt).getTime()<=clock);
  const report=(promise:Promise<unknown>)=>void promise.catch(e=>setError(errorText(e)));

  useEffect(()=>{
    const start=()=>{setOnline(navigator.onLine);void scheduleSync().catch(()=>{});};
    const visibility=()=>{if(document.visibilityState==='visible') start();};
    const workerMessage=(event:MessageEvent)=>{if(event.data?.type==='show-reminders')setPage('reminders');};
    start(); window.addEventListener('online',start); window.addEventListener('offline',start);
    window.addEventListener('focus',start);document.addEventListener('visibilitychange',visibility);
    navigator.serviceWorker?.addEventListener('message',workerMessage);
    const timer=window.setInterval(()=>{setClock(Date.now());if(navigator.onLine)void syncNow();},10000);
    return()=>{clearInterval(timer);window.removeEventListener('online',start);window.removeEventListener('offline',start);window.removeEventListener('focus',start);document.removeEventListener('visibilitychange',visibility);navigator.serviceWorker?.removeEventListener('message',workerMessage);};
  },[]);
  useEffect(()=>{void voiceInputAvailable().then(setVoiceAvailable);},[]);
  useEffect(()=>{
    if(!settings)return;
    document.documentElement.dataset.theme=settings.theme;
    document.documentElement.dataset.scanlines=String(settings.scanlines);
    document.documentElement.dataset.motion=settings.reducedMotion?'reduced':'full';
    document.documentElement.dataset.size=settings.fontSize;
    document.documentElement.style.setProperty('--glow',String(settings.glow/100));
  },[settings]);
  useEffect(()=>{
    if(!message)return;const timer=setTimeout(()=>setMessage(''),5000);return()=>clearTimeout(timer);
  },[message]);
  useEffect(()=>{
    if(!settings)return;
    const fire=async()=>{
      for(const item of due.filter(r=>r.status!=='FIRED')) {
        const latest=await db.reminders.get(item.id);
        if(!latest || latest.version!==item.version)continue;
        if(settings.notifications && 'Notification' in window && Notification.permission==='granted') {
          try {
            const registration=await navigator.serviceWorker?.getRegistration();
            if(registration)await registration.showNotification(item.title,{body:item.body || 'Пора вернуться к этой мысли',tag:item.id,icon:'/icon-192.png'});
            else new Notification(item.title,{body:item.body,tag:item.id});
          } catch { /* The overdue item stays visible even if OS notifications fail. */ }
        }
        await saveReminder({...item,status:'FIRED'});
      }
    };
    if(due.some(r=>r.status!=='FIRED')) {
      const task=navigator.locks ? navigator.locks.request('vault-terminal-reminders',fire) : fire();
      report(task.then(()=>scheduleSync()));
    }
  },[clock,settings?.notifications]);

  async function capture(event?:FormEvent) {
    event?.preventDefault(); if(busy || !text.trim())return;
    setBusy(true);setError('');
    try {await saveNote(text,title);setTitle('');setText('');setMessage('Сохранено локально. Мысль в безопасности.');void scheduleSync();captureRef.current?.focus();}
    catch(e) {setError('Не удалось сохранить. Текст остаётся в поле. '+errorText(e));}
    finally {setBusy(false);}
  }
  async function captureVoice() {
    if (busy || recording) return;
    setRecording(true);setError('');
    try {
      const speech=await dictate(navigator.language || 'ru-RU');
      if (speech) { setText(current=>appendVoiceText(current,speech));setMessage('Речь добавлена в черновик. Проверьте текст перед сохранением.'); }
    } catch (e) { setError(errorText(e)); }
    finally { setRecording(false);captureRef.current?.focus(); }
  }
  async function download() {
    const data=await exportData(); const contents=JSON.stringify(data,null,2); const name='vault-terminal-'+new Date().toISOString().slice(0,10)+'.json';
    if (isNativeAndroid()) {
      await exportNativeJson(name,contents);
      setMessage('RAW-данные сохранены в Documents/VaultTerminal');
      return;
    }
    const url=URL.createObjectURL(new Blob([contents],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    setMessage('RAW-заметки, напоминания и очередь экспортированы');
  }
  async function updateReminder(item:Reminder,patch:Partial<Reminder>) {await saveReminder({...item,...patch});await scheduleSync();}
  async function searchVault(event:FormEvent) {
    event.preventDefault();const text=query.trim();if(text.length<2)throw new Error('Введите хотя бы два символа для поиска в Obsidian.');
    setVaultSearching(true);setError('');
    try { const result=await api<{results:VaultSearchResult[]}>('/api/v1/vault/search?q='+encodeURIComponent(text));setVaultResults(result.results); }
    finally { setVaultSearching(false); }
  }
  const openPage=(id:Page)=>{setPage(id);setMobileNav(false);setError('');};
  const filteredNotes=notes.filter(n=>(inboxFilter==='archive'?n.archived:!n.archived) && (inboxFilter!=='pending' || queue.some(q=>q.entityId===n.id)) && (inboxFilter!=='synced' || !!n.serverReceivedAt));
  const foundNotes=activeNotes.filter(n=>n.text.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru')));
  const filteredReminders=reminders.filter(r=>{
    if(reminderFilter==='done')return r.status==='DONE';
    if(['CANCELLED','DONE'].includes(r.status))return false;
    if(reminderFilter==='today')return new Date(r.remindAt).toDateString()===new Date(clock).toDateString();
    if(reminderFilter==='overdue')return new Date(r.remindAt).getTime()<clock;
    return true;
  });

  return <div className="app-shell">
    <aside className={'sidebar '+(mobileNav?'is-open':'')}>
      <a className="brand" href="#" onClick={e=>{e.preventDefault();openPage('capture');}}><span className="brand-symbol"><Terminal size={24}/></span><span>VAULT<span className="brand-sub">TERMINAL</span></span><span className="version">01</span></a>
      <div className="workspace-tag"><span className="status-dot"/> ЛИЧНОЕ ПРОСТРАНСТВО</div>
      <div className="nav-label">РАБОЧИЙ СТОЛ</div>
      <nav aria-label="Основная навигация">{navigation.map(item=><button key={item.id} className={'nav-item '+(page===item.id?'active':'')} onClick={()=>openPage(item.id)} aria-current={page===item.id?'page':undefined}><item.icon size={18}/><span>{item.label}</span>{item.id==='inbox'&&activeNotes.length>0?<span className="nav-count">{activeNotes.length}</span>:item.id==='reminders'&&due.length>0?<span className="nav-count">{due.length}</span>:page===item.id?<ChevronRight size={14}/>:null}</button>)}</nav>
      <div className="sidebar-bottom"><div className="mini-terminal"><ShieldCheck size={21}/><strong>Сначала сохранить.</strong><span>Всё остальное — потом.</span><div className="signal-bars">{Array.from({length:24},(_,i)=><i key={i} style={{height:8+(i*13%23)}}/>)}</div><small>RAW DATA IS SACRED</small></div><button className="device-button" onClick={()=>setSyncPanel(true)}><span className="device-icon"><Laptop size={17}/></span><span>{settings?.deviceName ?? 'Моё устройство'}<small>Локальное хранилище</small></span><Settings2 size={15}/></button></div>
    </aside>
    {mobileNav&&<button className="nav-scrim" aria-label="Закрыть меню" onClick={()=>setMobileNav(false)}/>}
    <div className="workspace">
      <header className="topbar"><button className="icon-button mobile-menu" aria-label="Открыть меню" onClick={()=>setMobileNav(true)}><Menu size={21}/></button><div className="breadcrumb">ПРОСТРАНСТВО <ChevronRight size={12}/><span>{navigation.find(n=>n.id===page)?.label}</span></div><div className="topbar-right"><span className="today">{new Date(clock).toLocaleDateString('ru-RU',{day:'2-digit',month:'short',year:'numeric'})}</span><button className={'connection '+(!online||syncError?'muted':'')} onClick={()=>setSyncPanel(true)}>{online?<Wifi size={14}/>:<WifiOff size={14}/>}<span>{!online?'Офлайн':syncError?'Нет связи с сервером':'На связи'}</span><span className="status-dot"/></button></div></header>
      <main>
        {error&&<div className="alert error" role="alert">{error}<button aria-label="Закрыть ошибку" onClick={()=>setError('')}><X size={16}/></button></div>}
        {due.length>0&&page!=='reminders'&&<button className="due-banner" onClick={()=>setPage('reminders')}><Bell size={17}/>Пора вернуться к запланированному · {due.length}<ArrowRight size={16}/></button>}
        {page==='capture'&&<>
          <div className="page-heading"><div><div className="eyebrow"><span/> CAPTURE / 01</div><h1>Освободите голову<span className="accent">.</span></h1><p>Мыслям нужно место. Просто запишите — остальное подождёт.</p></div><span className="heading-code">[ RECORD FIRST ]</span></div>
          <div className="capture-grid"><section className="capture-panel"><form onSubmit={capture}><div className="panel-top"><span><span className="status-dot"/> НОВАЯ ЗАПИСЬ</span><span>RAW / TEXT</span></div><label className="capture-title" htmlFor="note-title">Название <span>необязательно</span><input id="note-title" value={title} disabled={busy||recording} onChange={e=>setTitle(e.target.value)} placeholder="Например: Идея для ролика" maxLength={MAX_NOTE_TITLE}/></label><label className="sr-only" htmlFor="thought">Что сейчас в голове?</label><textarea ref={captureRef} id="thought" value={text} disabled={busy||recording} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();void capture();}}} placeholder={'Что сейчас в голове?\n\nИдея, задача, случайная мысль…'} maxLength={Math.max(0,MAX_TEXT-(title.trim()?title.trim().length+4:0))}/><div className="editor-meta"><span>{recording?'Слушаю… скажите мысль':'Черновик · ещё не сохранён'}</span><span>{(text.length+(title.trim()?title.trim().length+4:0)).toLocaleString('ru')} / 100 000</span></div><div className="capture-actions"><div className="capture-controls"><button className="secondary voice-button" type="button" disabled={busy||recording||!voiceAvailable} onClick={()=>void captureVoice()} title={voiceAvailable?'Продиктовать текст':'Голосовой ввод недоступен на этом устройстве'}><Mic size={16}/>{recording?'Слушаю…':'Надиктовать'}</button><span className="shortcut"><kbd>Ctrl</kbd> + <kbd>↵</kbd><span>сохранить</span></span></div><button className="primary" type="submit" disabled={busy||recording||(!title.trim()&&!text.trim())}>{busy?'Сохраняем…':'Сохранить мысль'}<CornerDownLeft size={17}/></button></div></form><div className="capture-footnote"><ShieldCheck size={14}/><span>Аудио не сохраняется и не уходит на сервер: в заметку попадёт только проверяемый текст.</span></div></section>
          <aside className="system-panel"><div className="panel-top"><span>СИСТЕМА ХРАНЕНИЯ</span><span className="tiny-cross">+</span></div><div className="vault-emblem" aria-hidden="true"><div className="emblem-orbit orbit-one"/><div className="emblem-orbit orbit-two"/><div className="emblem-core"><Terminal size={39} strokeWidth={1.4}/></div><span className="orbit-point"/></div><h3>Каждая мысль на месте</h3><p>Сначала на устройстве.<br/>Затем — в вашем хранилище.</p><div className="pipeline"><div><span className="step-icon"><Check size={12}/></span><span>Устройство</span><strong>ГОТОВО</strong></div><div><span className="step-icon"><Cloud size={12}/></span><span>Сервер</span><strong className={!lastSync?'dim':''}>{lastSync?'СВЯЗАН':'ОЖИДАНИЕ'}</strong></div><div><span className="step-icon"><Inbox size={12}/></span><span>Obsidian</span><strong className="dim">{notes.some(n=>n.vaultPath)?'СВЯЗАН':'ОЖИДАНИЕ'}</strong></div></div><button className="text-button" onClick={()=>setSyncPanel(true)}>Состояние синхронизации<ArrowRight size={14}/></button></aside></div>
          <section className="recent-section"><div className="section-heading"><h2>Последние записи <span>{activeNotes.length.toString().padStart(2,'0')}</span></h2><button className="text-button" onClick={()=>setPage('inbox')}>Все записи<ArrowRight size={15}/></button></div>{activeNotes.length?<div className="note-list">{activeNotes.slice(0,4).map(n=><NoteRow key={n.id} note={n} onOpen={()=>setSelected(n)}/>)}</div>:<Empty icon={<FileText size={26}/>} title="Здесь начнётся ваша история" text="Сохраните первую мысль. Она появится здесь, даже если вы офлайн."/>}</section>
        </>}
        {page==='inbox'&&<><PageHeading code="INBOX / 02" title="Ваши записи" description="Исходные мысли — целиком, без изменений."/><div className="toolbar"><Tabs value={inboxFilter} onChange={setInboxFilter} items={[['all','Все'],['pending','В очереди'],['synced','На сервере'],['archive','Архив']]}/><button className="secondary" onClick={()=>report(download())}><ArrowDownToLine size={16}/>Экспорт RAW</button></div><div className="note-list">{filteredNotes.map(n=><NoteRow key={n.id} note={n} onOpen={()=>setSelected(n)}/>)}</div>{!filteredNotes.length&&<Empty icon={<Inbox size={28}/>} title="Пока пусто" text="Все новые записи появятся здесь. Архивирование не удаляет оригинал."/>}</>}
        {page==='ask'&&<><PageHeading code="SEARCH / 03" title="Вернитесь к мысли" description="Сначала ищем на этом устройстве, затем — в выгруженном Obsidian."/><form className="search-box" onSubmit={e=>report(searchVault(e))}><Search size={21}/><input aria-label="Поиск по заметкам" value={query} onChange={e=>{setQuery(e.target.value);setVaultResults(null);}} placeholder="Слово или фраза из вашей заметки…" autoFocus/>{query&&<button className="icon-button" type="button" aria-label="Очистить поиск" onClick={()=>{setQuery('');setVaultResults(null);}}><X size={18}/></button>}<button className="secondary" type="submit" disabled={vaultSearching||query.trim().length<2}>{vaultSearching?'Ищем…':'Искать в Obsidian'}</button></form><div className="search-caption">{query?`На устройстве найдено: ${foundNotes.length}. Для копии Obsidian нажмите «Искать в Obsidian».`:'Локальный поиск не требует сети; серверный — по последней выгрузке Markdown.'}</div>{query?<div className="note-list">{foundNotes.map(n=><NoteRow key={n.id} note={n} onOpen={()=>setSelected(n)}/>)}</div>:<Empty icon={<Search size={30}/>} title="Всё начинается с одного слова" text="Идея проекта, название книги, случайная фраза. Введите то, что помните."/>}{query&&!foundNotes.length&&<Empty icon={<Search size={28}/>} title="Локальных совпадений нет" text="Попробуйте более короткое слово или выполните поиск по выгруженному Obsidian."/>}{vaultResults!==null&&<section className="recent-section"><div className="section-heading"><h2>Obsidian на сервере <span>{vaultResults.length}</span></h2></div>{vaultResults.length?<div className="note-list">{vaultResults.map(result=><article className="note-row" key={result.path}><span className="note-icon"><FileText size={19}/></span><span className="note-preview"><strong>{result.path}</strong><span>{result.excerpt}</span></span><span className="note-status"><CheckCheck size={14}/>v{result.version}</span></article>)}</div>:<Empty icon={<Search size={28}/>} title="Совпадений нет" text="Эти записи ещё не выгружались или в них нет искомой фразы."/>}</section>}<div className="future-note"><Sparkles size={18}/><div><strong>Codex в Obsidian</strong><p>Для полноценного ответа вопросом откройте Agent Chat: он читает локальное хранилище напрямую. Серверный поиск показывает безопасную Markdown-копию после команды «выгрузи vault на сервер».</p></div></div></>}
        {page==='reminders'&&<><PageHeading code="REMINDERS / 04" title="Вернуться вовремя" description="Освободите память для важного. О делах напомнит терминал."/><div className="toolbar"><Tabs value={reminderFilter} onChange={setReminderFilter} items={[['upcoming','Предстоящие'],['today','Сегодня'],['overdue','Просроченные'],['done','Готово']]}/><button className="primary" onClick={()=>setReminderEditor({})}><Plus size={17}/>Напоминание</button></div><div className="reminder-list">{filteredReminders.map(r=><article className="reminder-card" key={r.id}><button className={'done-toggle '+(r.status==='DONE'?'checked':'')} aria-label={'Отметить выполненным: '+r.title} disabled={r.status==='DONE'} onClick={()=>report(updateReminder(r,{status:'DONE'}))}>{r.status==='DONE'&&<Check size={15}/>}</button><div className="reminder-body"><h3>{r.title}</h3><p className={new Date(r.remindAt).getTime()<clock&&r.status!=='DONE'?'overdue':''}>{date(r.remindAt)} · {r.timezone}</p>{r.body&&<p>{r.body}</p>}</div><div className="reminder-actions">{r.status!=='DONE'&&<select aria-label={'Отложить: '+r.title} value="" onChange={e=>{if(e.target.value==='custom')setReminderEditor(r);else report(updateReminder(r,{status:'SNOOZED',remindAt:new Date(Date.now()+Number(e.target.value)*60000).toISOString()}));}}><option value="" disabled>Отложить</option><option value="10">На 10 минут</option><option value="60">На час</option><option value="1440">На сутки</option><option value="custom">Выбрать время</option></select>}<button className="text-button" onClick={()=>setReminderEditor(r)}>Изменить</button><button className="icon-button" aria-label={'Удалить напоминание: '+r.title} onClick={()=>report(updateReminder(r,{status:'CANCELLED'}))}><X size={16}/></button></div></article>)}</div>{!filteredReminders.length&&<Empty icon={<Bell size={28}/>} title="Можно спокойно выдохнуть" text="В этом списке пока нет напоминаний. Создайте новое или добавьте его из заметки."/>}<div className="info-line"><CircleHelp size={17}/><span>В этой версии уведомления проверяются, пока приложение открыто. Пропущенные напоминания появятся при следующем входе.</span></div></>}
        {page==='settings'&&settings&&<><PageHeading code="SETTINGS / 05" title="Ваш терминал" description="Настройте пространство под себя."/><SettingsPanel settings={settings} report={report} notify={setMessage} onExport={()=>report(download())}/></>}
      </main>
      <footer className="workspace-footer"><span><span className="status-dot"/> LOCAL FIRST. ALWAYS.</span><span>VAULT TERMINAL <b>v{APP_VERSION}</b></span><button className="text-button" onClick={()=>setSyncPanel(true)}>{queue.length?`${queue.length} в очереди`:'Очередь пуста'}<ArrowRight size={12}/></button></footer>
    </div>
    {message&&<div className="toast" role="status"><span><Check size={17}/></span>{message}</div>}
    {syncPanel&&<Modal title="Состояние синхронизации" onClose={()=>setSyncPanel(false)}><div className="sync-stats"><Stat label="Локальные RAW-записи" value={notes.length.toString()}/><Stat label="Операций в очереди" value={queue.length.toString()}/><Stat label="Последний обмен" value={lastSync?date(lastSync):'Ещё не было'}/><Stat label="Заметок в Obsidian" value={notes.filter(n=>n.vaultPath).length.toString()}/></div>{syncError&&<div className="alert error">{syncError}</div>}{queue.filter(q=>q.error).map(q=><div className="queue-error" key={q.operationId}><strong>{shortId(q.entityId)} · попыток: {q.attempts}</strong><p>{q.error}</p>{q.blocked&&q.entityType==='reminder'&&q.conflict!=null&&<button className="secondary" onClick={()=>report(preserveReminderConflict(q.entityId).then(()=>scheduleSync()))}>Сохранить локальную версию как копию</button>}</div>)}<p className="muted-text">Записи остаются на устройстве при любой ошибке. ПК-агент доставляет их в Obsidian после запуска.</p><button className="primary full" disabled={syncing} onClick={()=>report(syncNow(db,fetch,true))}><RefreshCw size={16} className={syncing?'spinning':''}/>{syncing?'Синхронизация…':'Синхронизировать сейчас'}</button></Modal>}
    {selected&&<Modal title="Оригинальная запись" onClose={()=>setSelected(undefined)}><div className="note-detail-meta"><span>{date(selected.clientCreatedAt)}</span><span>#{shortId(selected.id)}</span></div><pre className="raw-text">{selected.text}</pre><div className="note-detail-meta"><span>{statusLabels[notes.find(n=>n.id===selected.id)?.status ?? selected.status]}</span><span>RAW · без изменений</span></div><div className="detail-actions"><button className="secondary" onClick={()=>{setReminderEditor({noteId:selected.id,title:noteDisplayTitle(selected).slice(0,120),body:''});setSelected(undefined);}}><Bell size={16}/>Напомнить</button><button className="secondary" onClick={()=>report(db.notes.update(selected.id,{archived:!selected.archived}).then(()=>{setSelected(undefined);setMessage(selected.archived?'Запись возвращена во входящие':'Запись в локальном архиве. RAW сохранён.');}))}><Archive size={16}/>{selected.archived?'Вернуть':'В архив'}</button>{selected.vaultPath&&settings?.vaultName&&<a className="secondary" href={'obsidian://open?vault='+encodeURIComponent(settings.vaultName)+'&file='+encodeURIComponent(selected.vaultPath)}>Открыть в Obsidian</a>}</div><p className="muted-text">Архив относится только к этому устройству. Сохранённый текст нельзя изменить; новую версию можно записать отдельно.</p></Modal>}
    {reminderEditor&&<ReminderForm initial={reminderEditor} onClose={()=>setReminderEditor(undefined)} onSave={async input=>{await saveReminder(input);setReminderEditor(undefined);setMessage('Напоминание сохранено локально');void scheduleSync();}}/>}
  </div>;
}

function PageHeading({code,title,description}:{code:string;title:string;description:string}) {return <div className="page-heading"><div><div className="eyebrow"><span/>{code}</div><h1>{title}<span className="accent">.</span></h1><p>{description}</p></div></div>;}
function Empty({icon,title,text}:{icon:ReactNode;title:string;text:string}) {return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{text}</p></div>;}
function Tabs({value,onChange,items}:{value:string;onChange:(s:string)=>void;items:string[][]}) {return <div className="tabs">{items.map(([id,label])=><button key={id} className={value===id?'active':''} onClick={()=>onChange(id)} aria-pressed={value===id}>{label}</button>)}</div>;}
function noteDisplayTitle(note:Note) { return note.text.split('\n').find(t=>t.trim())?.replace(/^#{1,6}\s+/, '') || 'Без названия'; }
function NoteRow({note,onOpen}:{note:Note;onOpen:()=>void}) {return <button className="note-row" onClick={onOpen}><span className="note-icon"><FileText size={19}/></span><span className="note-preview"><strong>{noteDisplayTitle(note)}</strong><span>{date(note.clientCreatedAt)}<span className="note-id"> / {shortId(note.id)}</span></span></span><span className={'note-status '+(note.status==='SYNC_ERROR'?'warning':'')}>{note.serverReceivedAt?<CheckCheck size={14}/>:<span className="small-dot"/>}{statusLabels[note.status]}</span><ChevronRight className="note-arrow" size={17}/></button>;}
function Stat({label,value}:{label:string;value:string}) {return <div className="stat"><span>{label}</span><strong>{value}</strong></div>;}
function Modal({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const dialog=ref.current;dialog?.showModal();return()=>dialog?.close();},[]);
  return <dialog ref={ref} className="modal" onCancel={onClose} onClick={e=>{if(e.target===ref.current)onClose();}}><div className="modal-header"><h2>{title}</h2><button className="icon-button" aria-label="Закрыть" onClick={onClose}><X size={21}/></button></div>{children}</dialog>;
}
function ReminderForm({initial,onClose,onSave}:{initial:Partial<Reminder>;onClose:()=>void;onSave:(input:Omit<Reminder,'id'|'createdAt'|'updatedAt'|'version'> & {id?:string})=>Promise<void>}) {
  const [title,setTitle]=useState(initial.title ?? ''); const [body,setBody]=useState(initial.body ?? '');
  const [when,setWhen]=useState(localDate(initial.remindAt?new Date(initial.remindAt):new Date(Date.now()+3600000)));
  const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  return <Modal title={initial.id?'Изменить напоминание':'Новое напоминание'} onClose={onClose}><form className="form-stack" onSubmit={async e=>{e.preventDefault();setBusy(true);try{await onSave({id:initial.id,noteId:initial.noteId ?? null,title,body,remindAt:new Date(when).toISOString(),timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,status:'PENDING'});}catch(error){setError(errorText(error));}finally{setBusy(false);}}}><label>О чём напомнить<input required maxLength={500} value={title} onChange={e=>setTitle(e.target.value)}/></label><label>Когда<input required type="datetime-local" value={when} onChange={e=>setWhen(e.target.value)}/></label><label>Подробности<textarea value={body} onChange={e=>setBody(e.target.value)} maxLength={MAX_TEXT} rows={3}/></label><p className="muted-text">Часовой пояс: {Intl.DateTimeFormat().resolvedOptions().timeZone}</p>{error&&<p role="alert" className="error-text">{error}</p>}<button className="primary full" disabled={busy||!title.trim()} type="submit">Сохранить напоминание<Check size={17}/></button></form></Modal>;
}
function SettingsPanel({settings,report,notify,onExport}:{settings:Settings;report:(p:Promise<unknown>)=>void;notify:(s:string)=>void;onExport:()=>void}) {
  const [name,setName]=useState(settings.deviceName);const [url,setUrl]=useState(settings.serverUrl);const [token,setToken]=useState('');const [vault,setVault]=useState(settings.vaultName);
  const [pairing,setPairing]=useState(false);
  const update=(patch:Partial<Settings>)=>db.settings.update('settings',patch);
  const saveConnection=async()=>{
    const clean=url.trim().replace(/\/+$/,'');
    if(clean){
      const parsed=new URL(clean);
      if(parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname!=='/') throw new Error('Укажите только адрес сервера, без пути и паролей');
      if(parsed.protocol!=='https:'&&!(['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)&&parsed.protocol==='http:')) throw new Error('Для удалённого сервера требуется HTTPS');
    }
    await update({deviceName:name.trim()||'Моё устройство',serverUrl:clean,vaultName:vault.trim()});
  };
  const pasteToken=async()=>{
    const value=(await Clipboard.read()).value.trim();
    if(!value) throw new Error('Буфер обмена пуст. Скопируйте токен и повторите.');
    if(value.length>200) throw new Error('Токен слишком длинный. Скопируйте его целиком без дополнительного текста.');
    setToken(value); notify('Токен вставлен. Нажмите «Подключить устройство».');
  };
  const connectDevice=async()=>{
    const pairingToken=token.trim();
    if(!pairingToken) throw new Error('Вставьте токен подключения.');
    setPairing(true);
    try {
      // Save the draft first: api() reads the server address from IndexedDB.
      await saveConnection();
      await api('/api/v1/session',{method:'POST',body:JSON.stringify({token:pairingToken})});
      // Do not claim success until the HttpOnly session cookie has been accepted by the WebView.
      await api('/api/v1/sync?cursor=0');
      setToken('');
      notify('Устройство подключено и проверено.');
      await scheduleSync();
    } finally { setPairing(false); }
  };
  return <div className="settings-grid"><section className="settings-card"><h2><Terminal size={20}/>Внешний вид</h2><p>Терминал с характером или спокойная классика.</p><div className="theme-picker">{(['terminal','classic-dark','classic-light'] as const).map((theme,i)=><button key={theme} aria-pressed={settings.theme===theme} className={'theme-option '+(settings.theme===theme?'selected':'')} onClick={()=>report(update({theme}))}><span className={'theme-swatch swatch-'+theme}><span/><i/><i/></span>{['Терминал','Тёмная','Светлая'][i]}</button>)}</div><label className="setting-row">Линии CRT<input type="checkbox" checked={settings.scanlines} onChange={e=>report(update({scanlines:e.target.checked}))}/></label><label className="setting-row">Свечение<input aria-label="Свечение" type="range" min="0" max="100" value={settings.glow} onChange={e=>report(update({glow:Number(e.target.value)}))}/></label><label className="setting-row">Уменьшить движение<input type="checkbox" checked={settings.reducedMotion} onChange={e=>report(update({reducedMotion:e.target.checked}))}/></label><label className="setting-row">Размер текста<select value={settings.fontSize} onChange={e=>report(update({fontSize:e.target.value as Settings['fontSize']}))}><option value="s">Маленький</option><option value="m">Средний</option><option value="l">Большой</option></select></label></section>
    <section className="settings-card"><h2><Cloud size={20}/>Устройство и сервер</h2><p>Пустой адрес использует сервер приложения.</p><form className="form-stack" onSubmit={e=>{e.preventDefault();report((async()=>{await saveConnection();notify('Настройки подключения сохранены');await scheduleSync();})());}}><label>Имя устройства<input maxLength={100} value={name} onChange={e=>setName(e.target.value)}/></label><label>Адрес сервера<input type="url" value={url} onChange={e=>setUrl(e.target.value)} placeholder="Текущий сервер"/></label><label>Название Obsidian vault<input value={vault} onChange={e=>setVault(e.target.value)} placeholder="Для ссылки «Открыть в Obsidian»"/></label><button type="submit" className="secondary">Сохранить подключение</button></form><div className="pairing"><label>Токен подключения<input type="text" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} inputMode="text" value={token} onChange={e=>setToken(e.target.value)} placeholder="Из команды device:add"/></label><button className="secondary" type="button" disabled={pairing} onClick={()=>report(pasteToken())}>Вставить из буфера</button><button className="secondary" type="button" disabled={!token.trim()||pairing} onClick={()=>report(connectDevice())}>{pairing?'Подключаем…':'Подключить устройство'}</button><small>«Подключить устройство» сохраняет введённый адрес, проверяет сессию с сервером и не сохраняет токен.</small></div></section>
    <section className="settings-card"><h2><Bell size={20}/>Уведомления</h2><p>Напоминания в открытом приложении. Доставка при закрытом приложении появится с Push / Android.</p><button className="secondary" onClick={()=>report((async()=>{if(!('Notification' in window))throw new Error('Этот браузер не поддерживает уведомления');const permission=await Notification.requestPermission();await update({notifications:permission==='granted'});notify(permission==='granted'?'Уведомления включены':'Уведомления запрещены браузером; напоминания доступны в приложении');})())}>{settings.notifications?'Проверить разрешение':'Разрешить уведомления'}</button>{settings.notifications&&<button className="text-button" onClick={()=>report(update({notifications:false}))}>Выключить уведомления</button>}</section>
    <section className="settings-card"><h2><ShieldCheck size={20}/>Ваши данные</h2><p>Экспорт включает все оригиналы, напоминания и неотправленные операции. Сервер и Obsidian для экспорта не нужны.</p><button className="secondary" onClick={onExport}><ArrowDownToLine size={16}/>Скачать JSON</button><button className="text-button" onClick={()=>report((async()=>{const granted=await navigator.storage?.persist?.();notify(granted?'Браузер разрешил постоянное хранение':'Браузер управляет очисткой хранилища. Регулярно экспортируйте RAW.');})())}>Запросить постоянное хранение<ArrowRight size={15}/></button><small>Очистка данных сайта в браузере удалит локальные записи. В приложении нет автоматического удаления RAW.</small></section></div>;
}
