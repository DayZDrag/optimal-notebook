# Vault Terminal

Персональный offline-first блокнот для быстрого захвата мыслей, надёжной синхронизации, напоминаний и последующей интеграции с локальным Obsidian.

## Текущий этап

Рабочая версия 0.1: PWA, offline capture, идемпотентная серверная синхронизация, базовые напоминания и ПК-доставка в Obsidian. UI на русском, терминальная и классические темы. Данные не зависят от AI.

## Состояние этапов

- MVP-1: реализованы React/PWA, IndexedDB, постоянная очередь, Hono, серверный журнал, retry и экспорт RAW. Локальная разработка использует SQLite; Vercel production — Neon PostgreSQL без DDL в request path и с передачей POST-body напрямую в Hono. Отдельный тест покрывает Vercel POST с заранее разобранным JSON-телом.
- MVP-2: реализованы CRUD, Done/Snooze, конфликты версий, уведомления в открытом приложении и нативный Android AlarmManager с вибрацией/heads-up после закрытия приложения. Web Push для браузерной версии ещё нужен.
- MVP-3: реализован Node/TypeScript ПК-агент, Markdown Inbox, ACK, повторный запуск и сохранение конфликтов. В Windows он может запускаться при входе (в том числе от батареи) и синхронизировать каждые 15 секунд только при открытом Obsidian. Подключение реального vault требует явного VAULT_PATH.
- MVP-4/5: AI-сортировка и полноценный Reverse Ask ещё не реализованы. Codex Agent Chat читает локальный vault напрямую; экран поиска умеет искать как локальные RAW, так и последнюю выгруженную Markdown-копию Obsidian на сервере.
- MVP-6: создана Capacitor Android-обёртка и debug APK 0.1.7 (`versionCode` 8) для API 24+. Она содержит offline UI, очередь, экспорт в Documents/Share, deep-link scheme, нативную вставку токена, системный голосовой ввод, системные напоминания AlarmManager и проверяемое подключение к Vercel. Мост будильника корректно принимает 64-битное epoch-время. Название заметки хранится как Markdown-заголовок RAW. SAF и Share Sheet как входной канал ещё не реализованы.
- MVP-7: реализовано безопасное одностороннее зеркало разрешённого Markdown с SHA-256, сохранением серверных версий и поиском. Миграция для production выполняется Vercel до сборки. Автоматическая двусторонняя синхронизация, вложения и auto-merge конфликтов намеренно не реализованы.

## Технические решения

Node.js 24+, TypeScript, React, Vite, Dexie, Hono, встроенный node:sqlite и PostgreSQL-клиент. Единый StorageAdapter поддерживает SQLite для локального запуска и Neon PostgreSQL для serverless production на Vercel.

Проверки и команды находятся в [README.md](README.md); архитектура и протокол — в [docs/architecture.md](docs/architecture.md) и [docs/sync-protocol.md](docs/sync-protocol.md).

## Источник требований

[VAULT_TERMINAL_AGENT_SPEC.md](VAULT_TERMINAL_AGENT_SPEC.md).
