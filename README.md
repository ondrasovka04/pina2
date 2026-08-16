# Pína 2.0

Webová aplikace pro správu týmové píny (kasa za prohřešky), docházky a nominací
ve volejbalových týmech. Kompletní přepis původního ročníkového projektu z roku 2023
(Expo / React Native + PHP API).

**Produkce:** https://pinaprosek.eu · **Klub:** SK Prosek Praha (+ další týmy)

## Stav

Ve fázi návrhu. Analýzy v [`docs/`](docs/):

- [Technická analýza](docs/ANALYZA-TECHNICKA.md) — architektura, datový model, API, migrace, provoz
- [Netechnická analýza](docs/ANALYZA-NETECHNICKA.md) — funkce a role z pohledu uživatele

## Stack

| Vrstva | Technologie |
|---|---|
| Frontend | React 19 + TypeScript, Vite, TanStack Query, Tailwind + shadcn/ui, PWA |
| Backend | PHP 8.5, vlastní mikro-framework (Router → Service → Repository), PDO, JWT |
| Databáze | MySQL 8 |
| Hosting | Czechia / Zoner — Apache + PHP-FPM, deploy přes FTP |

Podrobné zdůvodnění voleb je v technické analýze, kapitola 3.

## Vývoj

```bash
docker compose up -d          # MySQL 8 + PHP 8.5 (shoda s produkcí)
npm install && npm run dev    # frontend na :5173, API proxy na :8080
composer install              # backend závislosti
```

Lokální databáze se plní kopií produkčního dumpu, takže migrace i dotazy se testují
proti reálným datům. Dump se do repa **necommituje** (osobní údaje).

## Fáze

| | Obsah | Stav |
|---|---|---|
| F0 | ověření hostingu, dump dat, repo, CI | probíhá |
| F1 | schéma, migrace, auth, role, design systém | |
| F2 | prohřešky — sazebník, dávkový zápis, přehledy | |
| F3 | docházka, nominace, opakované akce | |
| F4 | dluhy, platby, QR (SPAYD) | |
| F5 | PWA, Web Push | |
| F6 | párování plateb z bankovního API (follow-up) | |

Cíl: F1 + F2 na start sezóny 26/27 (září 2026), pak vypnout starou aplikaci.
