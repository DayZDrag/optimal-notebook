# Changelog

## Unreleased

- Добавлен адаптер Neon PostgreSQL с транзакциями, неизменяемыми RAW-оригиналами, append-only sync log, токенами устройств и сессиями.
- Добавлены Vercel Function `/api/*`, `vercel.json` и инструкции для независимой от ПК синхронизации Android APK через Vercel + Neon.
- Команды управления устройствами и seed теперь работают и с `DATABASE_URL`, не только с локальной SQLite.

## 0.1.1 — 2026-09-06

- Добавлена Capacitor Android-обёртка API 24+ с app ID `app.vaultterminal.notebook`, нативной иконкой и deep-link scheme `vaultterminal://`.
- Добавлены встроенный офлайн-интерфейс, экспорт JSON в Android Documents и системное меню Share.
- Собрана и проверена v2-подписью debug APK `artifacts/VaultTerminal-debug-0.1.0.apk`.
- Server CORS поддерживает несколько разрешённых origins, включая `https://localhost` для Capacitor Android.

## 0.1.0 — 2026-09-06

- Созданы запускаемые React/PWA, TypeScript/Hono backend и ПК-агент.
- Добавлены IndexedDB RAW+outbox с атомарным сохранением, retry/backoff, offline cache и идемпотентный серверный протокол.
- Добавлены SQLite-схема, SQL-защита неизменяемых оригиналов, append-only события и интерфейс хранилища.
- Реализованы входящие, локальный архив, полный просмотр оригинала, офлайн-поиск и JSON-экспорт.
- Добавлены напоминания, Done/Snooze, отмена, уведомления в открытом приложении и сохранение конфликтующих версий.
- Созданы русский интерфейс, терминальная/классические темы, настройки CRT, шрифта и reduced motion.
- Добавлены хешированные токены устройств, HttpOnly-сессии, revoke, лимиты запросов, проверка Origin и путей.
- ПК-агент записывает Markdown в Inbox, подтверждает доставку, сохраняет пользовательские правки и отдельную RAW-копию при конфликте.
- Добавлены тесты офлайн-сохранения, потерянного ACK, SQL rollback, конфликтов, авторизации, path traversal и браузерные PWA-сценарии.
- Обновлены README, PROJECT и STRUCTURED_IDEAS; AI/Reverse Ask, Android, Web Push и зеркало vault явно оставлены следующими этапами.

## Инициализация

- Инициализировано Obsidian-хранилище и базовая проектная документация.
