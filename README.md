# Pína 2.0

**EN:** Production web app for volleyball teams that handles the team fund, fines,
payments, attendance and match nominations. It's built with React 19, TypeScript,
TanStack Query and Tailwind as an installable PWA with Web Push and calendar feeds,
backed by a PHP 8 REST API with JWT auth and MySQL. Live at
**https://pinaprosek.eu**. The app is in Czech, as is the rest of this documentation.

Webová aplikace pro týmovou kasu, prohřešky, platby, docházku a nominace
volejbalových družstev. Běží na **https://pinaprosek.eu**.

## Projekt

- `web/` — React 19, TypeScript 7, Vite 8, Tailwind 4, TanStack Query; instalovatelná PWA.
- `api/` — PHP 8.5, PDO, JWT a MySQL 8.
- `docker/` — místní vývojové prostředí.
- `docs/` — zadání a technická analýza.

Pravidla vývoje jsou v [AGENTS.md](AGENTS.md), podrobnosti v
[api/AGENTS.md](api/AGENTS.md) a [web/AGENTS.md](web/AGENTS.md).

## Místní vývoj

Potřebujete Docker a Node.js 26 nebo novější. Konfigurace API vychází
z [api/.env.example](api/.env.example); vlastní hodnoty patří do `api/.env`.

```bash
docker compose up -d db
docker compose run --rm php composer install
docker compose up -d php
cd web
npm install
npm run dev
```

Web běží na `http://localhost:5173`, API na `http://localhost:8080`.
Vývojový server přeposílá požadavky `/api` na backend.
Schéma pro novou databázi je v `api/db/migrations/001_init.sql`.

Po změně obrazu PHP obnovte i běžící kontejner:

```bash
docker compose up -d --build --force-recreate php
```

## Ověření změn

```bash
docker compose run --rm php ./vendor/bin/phpunit
docker compose run --rm php ./vendor/bin/phpstan analyse --memory-limit=512M
docker compose run --rm php ./vendor/bin/php-cs-fixer fix --dry-run --diff
cd web
npm run typecheck && npm run lint && npm test && npm run format:check
npm run build
```

**Databázové testy smí běžet jen proti `pina_test` — před během mažou data.**
Ve vývoji zůstává pošta vypnutá (`MAIL_ENABLED=false`). Přístupové údaje,
databázové zálohy a osobní údaje nepatří do gitu.

## Nasazení

Aplikace běží na sdíleném webhostingu. Aktualizuje se přes FTP,
SSH není k dispozici. Cesty jsou vůči kořenu hostingového účtu:

| Obsah | Cíl |
|---|---|
| `api/src`, `api/vendor`, `api/db`, `api/tools` | `data/app/` |
| `api/public/*` | `public_html/api/` |
| `web/dist/*` bez `*.map` | `public_html/` |

Pro nasazení připravte závislosti API příkazem
`composer install --no-dev --optimize-autoloader` a web přes `npm run build`.
Produkční konfigurace je v `data/app/.env` s právy `600`.

Změny databáze provádějte dočasným PHP skriptem chráněným heslem: nahrajte ho,
spusťte přes HTTPS pomocí `curl`, ověřte výsledek a skript ihned smažte.
Připojení k databázi načítejte z existující konfigurace aplikace.

Při aktualizaci zachovejte `.env` a `data/app/storage/`. Databázi denně zálohuje
hosting. Obrázky v `storage/images/` databázová záloha neobsahuje; jejich zálohování
hostingem zatím nebylo ověřeno.
Adresář musí být zapisovatelný pro PHP; obrázky vyžadují GD s JPEG a WebP.

Oznámení obsluhuje úloha hostingu každých 15 minut:
`GET /api/v1/cron/notifications/send?token=…`. Používá `CRON_TOKEN`
a nastavení VAPID z produkční konfigurace.

Stejná úloha po odesílání promaže neplatné tokeny a dokončená oznámení
s rezervou **365 dní**, nejvýš 500 řádků z každé tabulky za běh. Počty vrací
v poli `cleanup`; aktivní relace, čekající zprávy a historie peněz zůstávají.
Pravidla jsou v [technické dokumentaci](docs/ANALYZA-TECHNICKA.md#49-automatický-úklid-provozních-dat).
