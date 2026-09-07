# VAULT TERMINAL — спецификация для агента разработки

> Статус: рабочая спецификация / source of truth  
> Версия: 0.1  
> Дата: 2026-09-05  
> Язык интерфейса по умолчанию: русский  
> Формат продукта: PWA + опциональная Android-обёртка  
> Главная интеграция: Obsidian vault + локальный AI-плагин

---

## 0. Инструкция агенту

Ты реализуешь проект по этой спецификации.

Приоритеты:
1. Надёжность хранения заметок.
2. Offline-first.
3. Никакая пользовательская запись не должна теряться даже при падении сети, сервера, AI или Obsidian.
4. RAW-оригинал заметки должен сохраняться неизменным.
5. AI — помощник для классификации, поиска и организации, но не единственная точка хранения.
6. Все операции синхронизации должны быть идемпотентными.
7. Не делать скрытых зависимостей от интерфейса ChatGPT и не использовать UI-автокликеры.
8. Не использовать OpenAI API как обязательную часть MVP.
9. AI-слой должен быть заменяемым.
10. Сначала рабочая простая версия, потом декоративные/продвинутые возможности.

Если какое-то решение в реализации конфликтует с сохранностью данных — выбирать сохранность данных.

---

# 1. Что строим

Персональный мобильный блокнот / second brain с быстрым сбросом мыслей, офлайн-режимом, синхронизацией, напоминаниями и интеграцией с Obsidian.

Основной UX:

```text
пришла мысль
→ открыл приложение
→ написал / надиктовал
→ Save
→ закрыл
→ забыл
```

Дальше система сама должна:

```text
локальная очередь
→ сервер
→ локальный Obsidian
→ AI-классификация
→ подходящая папка
```

Также нужен обратный сценарий:

```text
в приложении:
"что я писал про X?"
→ запрос ставится в очередь
→ локальный Obsidian + AI обрабатывают его
→ ответ сохраняется в vault
→ ответ синхронизируется обратно
→ приложение показывает результат
```

---

# 2. Главные возможности

## Обязательные

- быстрый ввод текста;
- работа без интернета;
- локальная очередь;
- автоматическая отправка очереди при восстановлении сети;
- серверное независимое хранение RAW-записей;
- синхронизация с локальным Obsidian;
- AI-сортировка новых заметок по существующим папкам;
- Inbox как безопасный fallback;
- запросы к своей базе заметок;
- ответы AI через файловый мост;
- напоминания;
- Pip-Boy / Fallout-terminal-inspired тема;
- обычная минималистичная тема;
- переключение тем;
- список статусов синхронизации;
- защита от дублей.

## Желательные после MVP

- голосовой ввод;
- картинки;
- ссылки;
- Android Share Sheet;
- теги;
- автоматические заголовки;
- wikilinks;
- семантический поиск;
- подборки заметок;
- AI-предложения напоминаний;
- серверное зеркало vault;
- полнотекстовый и векторный индекс;
- push-уведомления;
- PWA install;
- нативный Android wrapper.

---

# 3. Архитектура верхнего уровня

```text
┌───────────────────────────────────────────────┐
│                 MOBILE CLIENT                 │
│                                               │
│  Capture / Inbox / Ask / Reminders / Settings│
│                                               │
│  Local DB / Offline Queue                     │
└──────────────────────┬────────────────────────┘
                       │
                       │ HTTPS sync
                       ▼
┌───────────────────────────────────────────────┐
│                    SERVER                     │
│                                               │
│ RAW Notes DB                                  │
│ Reminder DB                                   │
│ Sync Event Log                                │
│ AI Request/Response Queue                     │
│ Optional Vault Mirror                         │
└──────────────────────┬────────────────────────┘
                       │
                       │ desktop/mobile sync
                       ▼
┌───────────────────────────────────────────────┐
│              LOCAL OBSIDIAN VAULT             │
│                                               │
│  00_Inbox/                                    │
│  Projects/                                    │
│  Study/                                       │
│  Thoughts/                                    │
│  Personal/                                    │
│  AI_Bridge/                                   │
│      requests/                                │
│      responses/                               │
│      failed/                                  │
└──────────────────────┬────────────────────────┘
                       │
                       ▼
┌───────────────────────────────────────────────┐
│             LOCAL OBSIDIAN AI LAYER           │
│                                               │
│ Chatting with AI / fork / bridge plugin       │
│                                               │
│ Reads vault                                   │
│ Classifies                                    │
│ Searches                                      │
│ Moves files                                   │
│ Writes responses                              │
└───────────────────────────────────────────────┘
```

---

# 4. Рекомендуемый стек

## Frontend

Предпочтительно:

- TypeScript;
- React;
- Vite;
- PWA manifest;
- Service Worker;
- Dexie.js поверх IndexedDB;
- CSS variables для тем;
- никаких тяжёлых UI-kit зависимостей без необходимости.

## Android

Архитектура должна позволять упаковать тот же frontend через Capacitor.

Причина:
- локальные уведомления;
- работа с файловой системой;
- Storage Access Framework;
- Android Share Sheet;
- deep links;
- более надёжные фоновые задачи.

PWA должна работать и без Capacitor.

## Backend

Предпочтительно TypeScript.

Допустимы:
- Hono;
- Fastify;
- Express.

Выбрать один простой стек.

Хранилище:
- PostgreSQL для production;
- SQLite допустим локально для dev/test.

ORM:
- Drizzle ORM или другой лёгкий типобезопасный слой.

Архитектуру хранения сделать через adapter/interface, чтобы backend можно было перенести на другой хостинг.

---

# 5. Offline-first

Это критическая часть.

При `Save` НЕЛЬЗЯ сначала ждать сервер.

Алгоритм:

```text
1. Пользователь нажал Save.
2. Создать UUID.
3. Записать RAW note в локальную БД.
4. status = LOCAL_PENDING.
5. Немедленно показать "Сохранено".
6. Попытаться отправить на сервер.
7. Если сеть недоступна — оставить в очереди.
8. При восстановлении сети — повторить.
9. После ACK сервера → SERVER_RECEIVED.
```

IndexedDB — обязательный web fallback.

Не хранить очередь только в памяти React.

## Синхронизация

Использовать несколько триггеров:

- сразу после Save;
- `window.online`;
- при открытии/возврате приложения;
- Service Worker Background Sync, если доступен;
- периодическая ручная retry-логика.

Background Sync считать оптимизацией, а не гарантией.

Никакая запись не должна зависеть от того, поддерживает ли браузер Background Sync.

---

# 6. Модель состояния заметки

Пример:

```text
LOCAL_PENDING
→ SERVER_RECEIVED
→ VAULT_INBOX
→ AI_PROCESSING
→ AI_SORTED
```

Дополнительные:

```text
SYNC_ERROR
AI_FAILED
NEEDS_REVIEW
ARCHIVED
```

Важно:

`AI_FAILED` не означает потерю заметки.

При ошибке AI заметка остаётся в:

```text
00_Inbox/
```

---

# 7. RAW-хранилище

Сырой пользовательский ввод не изменять.

Пример таблицы:

```sql
raw_notes
---------
id UUID PRIMARY KEY
created_at TIMESTAMP
updated_at TIMESTAMP
device_id UUID
text TEXT
content_type TEXT
client_created_at TIMESTAMP
server_received_at TIMESTAMP
status TEXT
source TEXT
deleted BOOLEAN DEFAULT FALSE
```

`text` — именно оригинальный ввод.

AI-версия хранится отдельно.

---

# 8. Рекомендуемые сущности БД

## devices

```text
id
name
platform
created_at
last_seen_at
token_hash
```

## raw_notes

См. выше.

## reminders

```text
id
note_id nullable
title
body
remind_at
timezone
status
created_at
updated_at
```

Статусы:

```text
PENDING
FIRED
DONE
SNOOZED
CANCELLED
```

## sync_events

Append-only event log.

```text
id
sequence
entity_type
entity_id
operation
payload
created_at
```

## ai_requests

```text
id
type
prompt
status
created_at
target_device nullable
```

Типы:

```text
CLASSIFY_INBOX
QUERY_VAULT
COLLECT_NOTES
MOVE_NOTES
CREATE_NOTE
```

## ai_responses

```text
id
request_id
status
answer
result_json
created_at
```

## vault_files (опционально V2)

Метаданные серверного зеркала:

```text
path
hash
version
modified_at
size
```

---

# 9. API

Версии API:

```text
/api/v1/...
```

Минимум:

## Notes

```http
POST /api/v1/notes
GET  /api/v1/notes
GET  /api/v1/notes/:id
```

POST должен быть идемпотентным по client UUID.

Повторная отправка одного `id` не создаёт дубль.

## Sync

```http
GET  /api/v1/sync?cursor=<cursor>
POST /api/v1/sync/ack
```

Ответ:

```json
{
  "events": [],
  "nextCursor": "..."
}
```

## AI bridge

```http
POST /api/v1/ai/requests
GET  /api/v1/ai/requests/:id
POST /api/v1/ai/responses
```

## Reminders

```http
POST   /api/v1/reminders
GET    /api/v1/reminders
PATCH  /api/v1/reminders/:id
DELETE /api/v1/reminders/:id
```

---

# 10. Локальный Obsidian

Новые записи сначала должны попадать:

```text
00_Inbox/
```

Пример файла:

```markdown
---
id: "019..."
created: "2026-09-05T15:00:00+03:00"
source: "vault-terminal-mobile"
raw_note_id: "019..."
ai_status: "pending"
---

сырая пользовательская мысль без изменения смысла
```

Имя файла не должно зависеть только от заголовка.

Пример:

```text
2026-09-05_15-00_019abc.md
```

---

# 11. AI-сортировка

Цель AI на первом этапе:

```text
00_Inbox/
→ существующая подходящая папка
```

Не усложнять AI-задачу в MVP.

AI получает:
- текст заметки;
- список доступных папок;
- при необходимости краткий контекст структуры vault.

AI должен вернуть структурированный результат:

```json
{
  "folder": "Study/AI",
  "title": "Mixture of Experts",
  "confidence": 0.91,
  "reason": "..."
}
```

Правила:

```text
confidence >= 0.75
→ можно автоматически переместить.

confidence < 0.75
→ оставить в 00_Inbox.
```

Порог вынести в settings.

AI не должен удалять RAW.

---

# 12. Chatting with AI / Obsidian AI

Предпочтительная стратегия:

- использовать существующий `Chatting with AI` как основу;
- либо сделать fork;
- либо написать companion bridge, если публичный API плагина это позволяет.

Не полагаться на автоматическое слежение обычного плагина за папкой, если это явно не поддержано.

Предпочтительный вариант для полной автоматизации:

```text
fork Chatting with AI
+
AI_Bridge worker
```

Bridge должен:

```text
при запуске Obsidian:
    scan AI_Bridge/requests/

при создании нового request:
    enqueue request

для каждого pending request:
    process
    write response
    update status
```

Важно:
- последовательно обрабатывать очередь;
- не запускать 10 AI-agent loops одновременно;
- хранить failed requests;
- иметь retry limit;
- иметь журнал.

---

# 13. Файловый AI Bridge

Структура:

```text
AI_Bridge/
├── requests/
├── responses/
├── processing/
└── failed/
```

## Request

```markdown
---
id: "req-019..."
type: "QUERY_VAULT"
status: "pending"
created: "..."
return_to: "server"
---

Что я писал про альтернативную математику?
```

## Response

```markdown
---
id: "req-019..."
status: "completed"
completed: "..."
---

У тебя есть связанные заметки:

- [[Информация как фундамент реальности]]
- [[Альтернативная математика]]
...
```

Дополнительно можно создать:

```json
{
  "requestId": "...",
  "status": "completed",
  "relatedFiles": [
    "Thoughts/Alternative Mathematics.md"
  ]
}
```

---

# 14. Сценарий "Ask Vault"

Пользователь в приложении пишет:

```text
Что я писал про альтернативную математику?
```

Дальше:

```text
APP
→ ai_requests
→ SERVER
→ sync
→ AI_Bridge/requests
→ Obsidian AI
→ AI_Bridge/responses
→ sync обратно
→ SERVER
→ APP
```

Если локальный Obsidian выключен:

```text
request = PENDING
```

Пользователь должен видеть:

```text
"Запрос ожидает устройство с Obsidian"
```

Ничего не терять.

---

# 15. Android app ↔ локальный Obsidian

Если используется Capacitor/native wrapper:

пользователь один раз выбирает папку vault через Android Storage Access Framework.

Сохранить разрешение.

App может использовать специально выделенную папку:

```text
AI_Bridge/
```

Нельзя бесконтрольно менять весь vault со стороны app.

Приложение:
- пишет requests;
- читает responses;
- при необходимости создаёт Inbox-файлы.

AI делает содержательную работу внутри Obsidian.

---

# 16. Deep links

Нужны два направления.

## App → Obsidian

Использовать `obsidian://`.

Цели:
- открыть vault;
- открыть конкретный request;
- разбудить Obsidian для обработки очереди.

## Obsidian → App

Свой scheme:

```text
vaultterminal://
```

Пример:

```text
vaultterminal://ai-response?id=req-123
```

После обработки плагин может предложить/выполнить возврат в app.

Не делать обязательным для MVP.

---

# 17. ПК sync agent

Нужен небольшой агент для Windows.

Задачи:

```text
on startup / logon:
    connect server
    download unsynced notes
    write 00_Inbox files
    download AI requests
    upload AI responses
    sync allowed vault changes
```

Предпочтительно:
- Node.js/TypeScript, чтобы не плодить языки;
- или Python, если получится значительно проще.

Запуск:
- Windows Task Scheduler;
- trigger: log on.

Агент не должен управлять интерфейсом ChatGPT.

---

# 18. Серверное зеркало vault

Это V2, не блокирует MVP.

На сервере хранить не "запущенный Obsidian", а копию разрешённых файлов vault.

Пример:

```text
server-vault/
├── 00_Inbox/
├── Study/
├── Projects/
├── Thoughts/
└── Attachments/
```

Обязательно исключить:
- секреты;
- токены;
- plugin keychain;
- кеши;
- временные файлы.

По умолчанию НЕ синхронизировать полностью `.obsidian/`.

Whitelist лучше blacklist.

---

# 19. Конфликты файлов

Нельзя применять "last writer wins" молча.

Для каждого mutable-файла:

```text
path
version
sha256
modified_at
```

При upload:

```text
client_base_version == server_version
→ принять
→ version + 1
```

Иначе:

```text
CONFLICT
```

Создать конфликтную копию:

```text
Conflicts/<name> (conflict <date>).md
```

Не использовать AI auto-merge в MVP.

---

# 20. Напоминания

Напоминания — полноценная часть продукта.

Создание:
- вручную;
- из заметки;
- позже — AI suggestion.

Примеры:

```text
напомнить завтра в 15:00
через 2 часа
на выходных
```

## Источник правды

Основной reminder хранится в БД приложения/сервера.

Obsidian может иметь ссылку:

```yaml
reminder_id: "rem-123"
```

Это надёжнее, чем пытаться строить notification scheduler только на Markdown.

## Уведомления

PWA:
- Web Push с сервера;
- notification service worker.

Android wrapper:
- Local Notifications;
- использовать native scheduler;
- серверный push как дополнительный канал.

Для точных уведомлений без интернета Android wrapper предпочтительнее PWA.

---

# 21. AI-предложения напоминаний

V2.

Если пользователь пишет:

```text
надо посмотреть mixture of experts на выходных
```

AI может вернуть:

```json
{
  "containsTask": true,
  "suggestedReminder": {
    "title": "Посмотреть Mixture of Experts",
    "timeHint": "weekend"
  }
}
```

По умолчанию не создавать неоднозначное время молча.

Показать:

```text
Создать напоминание?
[На выходных] [Выбрать время] [Нет]
```

---

# 22. UI

Основная навигация:

```text
Capture
Inbox
Ask
Reminders
Settings
```

Дополнительно:
- Sync indicator;
- History.

## Capture

Минимум действий.

```text
Что сейчас в голове?

[ textarea ]

[voice]                     [SAVE]
```

После Save:

```text
✓ сохранено локально
```

Не блокировать кнопку из-за отсутствия сети.

---

# 23. Pip-Boy / terminal-inspired theme

Тема должна быть атмосферной, но удобной.

НЕ копировать фирменные логотипы, персонажей, графику или ассеты Fallout.

Можно использовать общую эстетику:
- монохромный CRT;
- зелёный/янтарный foreground через CSS variables;
- чёрный/тёмный фон;
- monospace;
- scanlines;
- glow;
- terminal borders;
- status text;
- keyboard-like controls.

Пример:

```text
VAULT TERMINAL
SYS.STATUS: ONLINE
SYNC: 3/3

> ENTER THOUGHT

[____________________________]

[ STORE ENTRY ]
```

## Настройки эффекта

```text
CRT Scanlines        ON/OFF
Glow                 0..100
Animation            ON/OFF
Reduced Motion       ON/OFF
Font Size            S/M/L
```

Не делать эффекты мешающими чтению.

---

# 24. Classic theme

Современный нейтральный интерфейс.

Требования:
- light/dark;
- нормальная типографика;
- без CRT;
- высокая читаемость.

Theme engine сделать через CSS variables:

```css
:root[data-theme="terminal"] {}
:root[data-theme="classic-dark"] {}
:root[data-theme="classic-light"] {}
```

Настройка должна сохраняться локально.

---

# 25. Экран Inbox

Показывать:

```text
NEW
SYNCED
PROCESSING
SORTED
FAILED
```

Карточка:

```text
14:31
"надо посмотреть..."
SERVER ✓
OBSIDIAN ✓
AI ...
```

Должна быть кнопка:
- retry;
- open;
- archive.

---

# 26. Экран Ask

Чатоподобный UX.

Но каждый запрос имеет backend id/status.

Состояния:

```text
queued
waiting-for-obsidian
processing
completed
failed
```

Пользователь может закрыть app.

Ответ позже появится в истории.

---

# 27. Экран Reminders

Фильтры:

```text
Today
Upcoming
Overdue
Done
```

Действия:
- Done;
- Snooze;
- Edit;
- Delete.

Snooze:
- 10 min;
- 1 hour;
- Tomorrow;
- custom.

---

# 28. Sync status

Отдельный маленький экран/панель:

```text
PHONE:
Local queue: 2

SERVER:
Connected

OBSIDIAN:
Last sync 15:31

AI:
1 request pending
```

Не скрывать ошибки.

---

# 29. Безопасность

Это личная база знаний, поэтому:

- только HTTPS;
- не хранить plaintext server/API secrets в frontend;
- device token хранить безопасно;
- токены на сервере хранить hash;
- предусмотреть revoke device;
- limit request size;
- rate limit;
- sanitize file paths;
- запрет `../`;
- не разрешать API произвольно писать вне vault root;
- не синхронизировать Obsidian secrets;
- audit log destructive actions;
- DELETE RAW — soft delete сначала.

Если используется ChatGPT account sign-in внутри Obsidian plugin:
- credential остаётся локально;
- сервер проекта не должен получать ChatGPT session/token.

---

# 30. Идемпотентность

Обязательна.

Пример:

```text
POST /notes id=abc
```

Первый раз:

```text
201 Created
```

Повтор после timeout:

```text
200 Already exists
```

Но не новая запись.

То же правило для:
- reminders;
- sync events;
- AI responses.

---

# 31. Retry

Exponential backoff:

```text
1s
2s
5s
10s
30s
1m
5m
...
```

С jitter.

После разумного количества попыток статус:

```text
ERROR_RETRYABLE
```

Запись остаётся.

---

# 32. Удаление

Никогда не удалять RAW автоматически после sync.

User delete:

```text
soft delete
→ trash
→ configurable retention
→ permanent delete
```

Vault-файл можно удалить отдельно, RAW остаётся пока пользователь явно не удалит его.

---

# 33. Логи

Логи не должны содержать полный текст личных заметок по умолчанию.

Логировать:

```text
note_id
operation
status
duration
error
```

Не:

```text
full_note_text
```

---

# 34. MVP

## MVP-1: Capture

Готово, когда:
- PWA устанавливается;
- работает офлайн;
- note сохраняется в IndexedDB;
- sync после появления сети;
- сервер хранит note;
- нет дублей.

## MVP-2: Reminders

Готово, когда:
- можно создать reminder;
- список upcoming;
- push/local notification;
- done/snooze.

## MVP-3: Obsidian ingestion

Готово, когда:
- PC agent получает новые notes;
- пишет `.md` в `00_Inbox`;
- ACK серверу;
- после перезапуска дублей нет.

## MVP-4: AI sort

Готово, когда:
- Obsidian AI bridge видит pending note;
- получает структуру папок;
- классифицирует;
- >threshold → переносит;
- low confidence → оставляет Inbox;
- RAW не меняет.

## MVP-5: Reverse Ask

Готово, когда:
- вопрос из app создаёт request;
- request появляется в `AI_Bridge/requests`;
- локальный AI его обрабатывает;
- создаёт response;
- response возвращается на сервер;
- app показывает ответ.

## MVP-6: Android native shell

Готово, когда:
- тот же frontend работает через Capacitor;
- local notification;
- vault folder permission;
- deep link;
- share target.

## MVP-7: Vault mirror

Готово, когда:
- разрешённые `.md`/attachments синкаются;
- hash/version;
- conflicts;
- секреты исключены.

---

# 35. Не делать в первой версии

Не тратить время на:
- сложный vector RAG;
- AI auto-merge конфликтов;
- совместную работу нескольких пользователей;
- end-to-end crypto до работающего MVP;
- сложный rich-text editor;
- кастомный Markdown renderer с нуля;
- сложную систему плагинов;
- UI automation ChatGPT;
- server-side эмуляцию Obsidian;
- десятки AI-провайдеров.

---

# 36. Тесты — критические сценарии

## Offline

1. Airplane mode.
2. Создать 10 записей.
3. Полностью закрыть app.
4. Вернуть интернет.
5. Открыть app либо дождаться supported background sync.
6. Все 10 должны появиться на сервере.
7. Дублей нет.

## Crash during sync

1. Отправить note.
2. Оборвать сеть между request и ACK.
3. Клиент повторяет.
4. Сервер имеет 1 запись.

## Server down

- Save продолжает работать.
- Очередь сохраняется после restart.

## Obsidian down

- notes остаются на server.
- статус `waiting-for-obsidian`.
- после запуска всё доставляется.

## AI down

- file остаётся в Inbox.
- статус `AI_FAILED`.
- retry возможен.
- исходник не изменён.

## Conflict

- один файл изменён server и local.
- ни одна версия не теряется.

## Reminder

- создать на ближайшее время;
- notification приходит;
- Done;
- Snooze;
- состояние синхронизируется.

---

# 37. Acceptance criteria

Проект НЕ считается готовым, если возможно:

- потерять note из-за offline;
- получить дубль после retry;
- AI удалить RAW;
- silently overwrite конфликт;
- потерять reminder;
- зависнуть навсегда в `PROCESSING`;
- записать файл за пределами vault;
- отправить ChatGPT credential на наш сервер.

---

# 38. Repo layout

Рекомендуемая монорепа:

```text
vault-terminal/
├── apps/
│   ├── web/
│   ├── server/
│   ├── desktop-sync/
│   └── android/            # Capacitor wrapper/config
│
├── packages/
│   ├── shared/
│   ├── db/
│   ├── sync-protocol/
│   └── ui/
│
├── obsidian-plugin/
│   └── vault-terminal-ai-bridge/
│
├── docs/
│   ├── architecture.md
│   ├── sync-protocol.md
│   └── threat-model.md
│
├── .env.example
├── docker-compose.yml
├── README.md
└── AGENTS.md
```

Если монорепа создаёт лишнюю сложность — разрешается упростить, но границы модулей сохранить.

---

# 39. Shared types

Типы должны быть общими между client/server.

Пример:

```ts
type NoteSyncStatus =
  | "LOCAL_PENDING"
  | "SERVER_RECEIVED"
  | "VAULT_INBOX"
  | "AI_PROCESSING"
  | "AI_SORTED"
  | "AI_FAILED"
  | "NEEDS_REVIEW";
```

Не дублировать вручную API DTO в нескольких приложениях.

---

# 40. Порядок реализации агентом

Строго рекомендуется:

```text
1. scaffold repo
2. shared types
3. local IndexedDB
4. Capture UI
5. backend notes API
6. idempotent sync
7. offline tests
8. reminders
9. desktop sync
10. Obsidian Inbox
11. Obsidian AI bridge
12. reverse Ask
13. Android wrapper
14. vault mirror
15. visual polish
```

НЕ начинать с AI.

Сначала доказать, что заметка не теряется.

---

# 41. Первый deliverable агента

Первый полноценный результат должен содержать:

- запускаемый frontend;
- запускаемый backend;
- `.env.example`;
- migration/schema DB;
- offline note capture;
- серверную sync;
- README с командами;
- dev seed;
- тест как минимум на idempotent note upload;
- terminal + classic theme scaffolding.

После этого переходить к Obsidian.

---

# 42. Dev commands

Агент должен привести проект к понятным командам, например:

```bash
npm install
npm run dev
npm run test
npm run lint
npm run build
```

И желательно:

```bash
docker compose up -d
```

для локальной БД.

---

# 43. Settings

Минимум:

```text
Theme
Server URL
Device name
Sync now
Obsidian integration status
AI confidence threshold
Notifications
Reduced motion
```

Debug settings:
- export queue;
- retry all;
- clear local cache (с предупреждением);
- connection diagnostics.

---

# 44. Резервное восстановление

Нужна функция экспорта RAW:

```text
JSON
```

И/или:

```text
Markdown ZIP
```

Даже если Obsidian не работает, пользователь может забрать все свои исходные заметки.

---

# 45. Версионирование протокола

Каждый клиент передаёт:

```text
protocolVersion
appVersion
deviceId
```

Backend должен уметь отклонить несовместимую версию понятной ошибкой.

---

# 46. UX-принцип

Capture должен быть быстрее любой организации.

Пользователь НЕ должен при записи:
- выбирать папку;
- выбирать 10 тегов;
- ждать AI;
- ждать server;
- думать о структуре.

Организация происходит потом.

---

# 47. Основная философия продукта

```text
CAPTURE NOW
ORGANIZE LATER
LOSE NOTHING
```

или в terminal-теме:

```text
> RECORD FIRST
> PROCESS LATER
> DATA MUST SURVIVE
```

---

# 48. Технические ограничения, которые учитывать

1. Background Sync в PWA нельзя считать универсальной гарантией.
   Нужны fallback-триггеры и постоянная IndexedDB очередь.

2. Chatting with AI работает на mobile/desktop и умеет работать с vault,
   но обычная работа инициируется пользовательским запросом.
   Для полностью автоматического `watch requests → run agent`
   нужен bridge/fork либо подтверждённый публичный command/API.

3. Не строить систему на неофициальной автоматизации UI ChatGPT.

4. Obsidian на сервере запускать не требуется.
   Для server mirror достаточно файлов vault + metadata/index.

5. PWA имеет меньше системных прав, чем native Android wrapper.
   Для надёжных локальных reminders и файлового доступа использовать Capacitor.

---

# 49. References for implementation

Проверить актуальные API перед реализацией:

- Obsidian URI:
  https://help.obsidian.md/Extending+Obsidian/Obsidian+URI

- Chatting with AI plugin:
  https://community.obsidian.md/plugins/chatting-with-ai

- Background Sync:
  https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API

- IndexedDB:
  https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API

Нельзя слепо предполагать наличие конкретного undocumented API у стороннего Obsidian-плагина.
Сначала проверить исходники/commands.

---

# 50. Итоговая целевая схема

```text
                            ┌───────────────────┐
                            │    REMINDERS      │
                            │ push / local      │
                            └─────────▲─────────┘
                                      │
                                      │
┌──────────────┐     offline      ┌───┴───────────────┐
│ MOBILE APP   │ ───────────────► │ LOCAL QUEUE       │
│ PWA/Android  │                  │ IndexedDB/native  │
└──────┬───────┘                  └────────┬──────────┘
       │                                  │
       │                                  │ sync
       │                                  ▼
       │                         ┌─────────────────────┐
       │                         │       SERVER        │
       │                         │ RAW DB              │
       │                         │ Reminder DB         │
       │                         │ Sync events         │
       │                         │ AI request queue    │
       │                         │ Vault mirror (V2)   │
       │                         └─────────┬───────────┘
       │                                   │
       │ ask                               │ sync
       ▼                                   ▼
┌──────────────┐                  ┌─────────────────────┐
│ ASK HISTORY  │◄──────────────── │ LOCAL OBSIDIAN      │
└──────────────┘    response      │                     │
                                  │ 00_Inbox            │
                                  │ AI_Bridge           │
                                  │ Projects            │
                                  │ Study               │
                                  │ Thoughts            │
                                  └─────────┬───────────┘
                                            │
                                            ▼
                                  ┌─────────────────────┐
                                  │ OBSIDIAN AI PLUGIN  │
                                  │                     │
                                  │ classify            │
                                  │ search              │
                                  │ move                │
                                  │ answer              │
                                  └─────────────────────┘
```

---

# 51. Финальное правило для агента

Не пытайся сделать всё сразу.

Сначала реализуй:

```text
offline capture
→ reliable server sync
→ reminder basics
```

Только после прохождения тестов надёжности переходи к:

```text
Obsidian
→ AI
→ reverse query
```

Каждая следующая стадия должна быть заменяемой и не должна ломать предыдущую.

RAW DATA IS SACRED.
