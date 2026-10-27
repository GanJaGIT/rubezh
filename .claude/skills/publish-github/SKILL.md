---
name: publish-github
description: Публикация игры на GitHub по образцу прошлых игр — README с баннером, гифкой, скриншотами, управлением и устройством проекта, тексты витрины, релиз с архивом и видео. Только по просьбе владельца.
disable-model-invocation: true
allowed-tools:
  - Bash(npm run *)
  - Bash(git status *)
  - Bash(git log *)
  - Bash(git diff *)
  - Bash(git add *)
  - Bash(git commit *)
  - Read
  - Grep
  - Glob
  - Write
  - Edit
---

# Публикация на GitHub

Образцы — https://github.com/GanJaGIT/sweet-conveyor и https://github.com/GanJaGIT/splav. Создание репозитория, `git push` и релиз — действия наружу: **перед ними спроси владельца** (имя репозитория, публичный или закрытый, что публикуем) и жди «да».

## 1. Предусловия

- `npm run verify` зелёный; `/yg-release` сделан (в `release/` есть архив и видео на каждом языке).
- `npm run promo -- --only=media` → `docs/media/`: `banner.png`, `icon.png`, `gameplay.gif` (из вертикального видео, ≤ 10 МБ), `phone-1.png`, `phone-2.png`, `desktop.png`. Посмотри каждую картинку.
- Тексты витрины: скопируй `release/draft-*.md` и `release/UPLOAD.md` в `docs/store/` (папка `release/` не в git).

## 2. Проверка на секреты

- `git ls-files | grep -i -E "\.env|secret|key|token"` — пусто.
- `git log -p --all | grep -i -E "(api[_-]?key|token|secret|password)\s*[:=]"` — пусто или только безопасные упоминания.
- Нет личных данных владельца в коде и документах, кроме имени автора; почта — только если владелец разрешил.

## 3. README.md

По образцу (русский, в конце — абзац «In English»):

1. Баннер `docs/media/banner.png` по центру, жирная строка-жанр и одно предложение о сути.
2. Бейджи shields.io: релиз (`/github/v/release/<owner>/<repo>`), TypeScript strict, Phaser 4.2, языки, «телефон · компьютер».
3. Таблица: слева `gameplay.gif` (ширина 270), справа «Что в игре» — 4–6 пунктов с конкретикой (сколько уровней, что за механики, мета, режимы).
4. «Скриншоты» — `desktop.png` во всю ширину и два телефона.
5. «Как играть» — таблица «Действие | Телефон | Компьютер».
6. «Запуск» — Node 24 LTS, `npm install`, `npm run dev`, параметры адреса (`?lang=en`, `?dev=1`, `?level=<id>`); таблица команд (`dev`, `verify`, `e2e`, `sim`, `art`, `promo`, `zip`/`check:build`, `dev:yg`, `check:yg`).
7. «Как устроено» — дерево папок с подписями и 4–5 пунктов: детерминированная симуляция, уровни проверены ботами, графика и звук без чужих ассетов, требования Яндекса в тестах (с цифрами: время до `ready()`, число e2e), витрина из кода.
8. «Как сделана» — Claude Code по этапам ТЗ; ссылки на `docs/TZ.md`, `docs/PROGRESS.md`, `docs/store/`, `CLAUDE.md`, `START.md`, `.claude/`.
9. «Релизы» — что лежит в релизе; архив рассчитан на SDK Яндекса и сам не запускается.
10. «Материалы и лицензия» — Nunito OFL, Phaser MIT, `CREDITS.md`; лицензия на код не выбрана, если владелец не сказал иное.

Пути к картинкам — относительные (`docs/media/...`). Коммит: `README: описание игры, скриншоты, управление, запуск, устройство`.

## 4. Репозиторий и релиз (после «да» владельца)

- Ветка `main` (`git branch -M main`, если была `master`).
- `gh repo create <owner>/<repo> --public|--private --source . --description "<одна фраза>" --push`; темы: `gh repo edit <owner>/<repo> --add-topic yandex-games,phaser,typescript,html5-game,<жанр>`.
- Релиз: `gh release create v<версия> release/<имя>-<версия>.zip release/video-*.mp4 --title "<Название> <версия>" --notes "<что внутри: архив для консоли, видео ru/en; что нового>"`. Заменить файл в готовом релизе — `gh release upload v<версия> <файл> --clobber`.
- Проверь страницу репозитория (встроенный браузер): README отрисован, картинки и гифка видны, релиз с файлами на месте.

## 5. Журнал

PROGRESS.md → «Сделано»: адрес репозитория, ветка, релиз и его файлы. Коммит и пуш (с разрешения).
