# Vault Terminal

Offline-first приложение для захвата заметок с будущей синхронизацией в локальный Obsidian vault.

## Статус

Репозиторий и Obsidian-документация инициализированы. Реализация MVP ещё не начата.

## Документация

- [PROJECT.md](PROJECT.md) — назначение и этап проекта;
- [VAULT_TERMINAL_AGENT_SPEC.md](VAULT_TERMINAL_AGENT_SPEC.md) — продуктовая и техническая спецификация;
- [STRUCTURED_IDEAS.md](STRUCTURED_IDEAS.md) — структурированные задачи;
- [CHANGELOG.md](CHANGELOG.md) — история изменений.

## План первого релиза

1. Создать TypeScript-монорепозиторий с web-клиентом и backend.
2. Реализовать offline capture в IndexedDB.
3. Добавить идемпотентную синхронизацию заметок с сервером.
4. Покрыть критический путь синхронизации тестом.
