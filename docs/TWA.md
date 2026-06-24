# TWA — упаковка PWA водителя в Android-приложение (APK)

Runbook по этапу O6 (ROADMAP). Цель — водитель ставит **настоящее приложение** (иконка, на весь экран,
без адресной строки браузера), а не «открывает ссылку». Внутри — та же офлайн-PWA (`/m`), поэтому
отдельной кодовой базы нет: TWA (Trusted Web Activity) — тонкая нативная обёртка над сайтом.

Платформа — только Android (Xiaomi/Samsung; айфонов в парке нет). Магазин не нужен — раздаём APK файлом.

## Предусловия (уже готовы)

- HTTPS-домен прода: **vmdrive24.ru** (TWA требует https).
- Web App Manifest: `https://vmdrive24.ru/manifest.webmanifest` (`display: standalone`, иконки 192/512 + maskable).
- Service worker с офлайн-кэшем: `https://vmdrive24.ru/sw.js`.
- Эндпоинт Digital Asset Links: `https://vmdrive24.ru/.well-known/assetlinks.json` (отдаётся приложением,
  заполняется отпечатком ключа через env — см. ниже).

## Вариант A (без локальных инструментов) — PWABuilder

Самый простой путь, ничего ставить не нужно:

1. Открыть https://www.pwabuilder.com, ввести `https://vmdrive24.ru`.
2. Package For Stores → **Android** → Generate Package.
3. Package ID: `ru.vmdrive.twa` (см. ниже — должен совпасть с `TWA_PACKAGE_NAME`).
4. Скачать zip: внутри `app-release-signed.apk` + `signing-key-info.txt` (там SHA-256 отпечаток) +
   готовый `assetlinks.json`.
5. Прописать отпечаток на проде (см. «Digital Asset Links») и раздать APK.

## Вариант B (CLI) — Bubblewrap

Нужны **JDK 17** и **Android SDK** (в текущем окружении их нет — ставить на машине сборки).

```bash
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://vmdrive24.ru/manifest.webmanifest
#  applicationId: ru.vmdrive.twa
#  name: VanMark Drive,  launcher: VanMark
#  display: standalone,  orientation: portrait
bubblewrap build
#  → app-release-signed.apk + android.keystore (ХРАНИТЬ! им подписываются обновления)
bubblewrap fingerprint list   # SHA-256 отпечаток ключа подписи
```

Конфиг-ориентир — `twa-manifest.example.json` рядом с этим файлом.

## Digital Asset Links (убрать адресную строку)

Чтобы приложение открывалось БЕЗ браузерной строки (verified TWA), домен должен подтвердить связь с
приложением. Эндпоинт уже реализован (`src/app/.well-known/assetlinks.json/route.ts`) и заполняется из env:

```env
TWA_PACKAGE_NAME=ru.vmdrive.twa
TWA_SHA256_FINGERPRINT=AB:CD:...:EF   # SHA-256 из сборки (Bubblewrap fingerprint / PWABuilder)
```

После задания env и редеплоя проверить:
```bash
curl https://vmdrive24.ru/.well-known/assetlinks.json   # должен вернуть package_name и отпечаток
```
Без `TWA_SHA256_FINGERPRINT` эндпоинт отдаёт `[]` (приложение всё равно работает, но с тонкой
адресной строкой Custom Tabs).

## Раздача и установка

1. APK выложить ссылкой (Telegram/диск) и прислать водителям.
2. На телефоне: разрешить «установку из неизвестных источников» для браузера/мессенджера, открыть APK, установить.
3. На экране — иконка VanMark; запуск открывает приложение во весь экран.

## Обновления

- **Контент/логику** обновлять НЕ нужно пересборкой: TWA грузит сайт с прода, поэтому деплой обновляет
  и приложение. Офлайн-кэш оболочки сам обновляется при следующем онлайне (новый `CACHE`-версия в `sw.js`).
- **Пересобирать APK** нужно только при смене имени/иконки/package id. Подписывать ТЕМ ЖЕ keystore
  (иначе обновление поверх установленного не встанет) — keystore хранить в `~/.vanmark-deploy/`.

## Заметки

- iOS не поддерживается (айфонов нет) — отдельная сборка под App Store не делается.
- Пуши в TWA работают через тот же web-push (FCM на стороне Chrome) — отдельная интеграция не нужна.
