# Vault Terminal

Персональный offline-first блокнот для быстрого захвата мыслей, надёжной синхронизации, напоминаний и последующей интеграции с локальным Obsidian.

## Текущий этап

Рабочая версия 0.1: PWA, offline capture, идемпотентная серверная синхронизация, базовые напоминания и ПК-доставка в Obsidian. UI на русском, терминальная и классические темы. Данные не зависят от AI.

## Состояние этапов

- MVP-1: реализованы React/PWA, IndexedDB, постоянная очередь, Hono, серверный журнал, retry и экспорт RAW. Локальная разработка использует SQLite; Vercel production — Neon PostgreSQL.
- MVP-2: реализованы CRUD, Done/Snooze, конфликты версий, уведомления в открытом приложении. Web Push и точный фоновый планировщик ещё нужны для полного MVP-2.
- MVP-3: реализован Node/TypeScript ПК-агент, Markdown Inbox, ACK, повторный запуск и сохранение конфликтов. Подключение реального vault требует явного VAULT_PATH.
- MVP-4/5: AI-сортировка и Reverse Ask ещё не реализованы. Экран поиска пока выполняет локальный поиск по тексту.
- MVP-6: создана Capacitor Android-обёртка и проверенная debug APK для API 24+. Она содержит offline UI, очередь, экспорт в Documents/Share и deep-link scheme. SAF, local notifications и Share Sheet как входной канал ещё не реализованы.
- MVP-7: зеркало vault отложено по спецификации.

## Технические решения

Node.js 24+, TypeScript, React, Vite, Dexie, Hono, встроенный node:sqlite и PostgreSQL-клиент. Единый StorageAdapter поддерживает SQLite для локального запуска и Neon PostgreSQL для serverless production на Vercel.

Проверки и команды находятся в [README.md](README.md); архитектура и протокол — в [docs/architecture.md](docs/architecture.md) и [docs/sync-protocol.md](docs/sync-protocol.md).

## Источник требований

[VAULT_TERMINAL_AGENT_SPEC.md](VAULT_TERMINAL_AGENT_SPEC.md).
