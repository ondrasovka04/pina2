# Pína 2.0

Webová aplikace pro správu týmové píny (kasa za prohřešky), docházky a nominací
ve volejbalových týmech. Kompletní přepis původního ročníkového projektu z roku 2023
(Expo / React Native + PHP API).

**Produkce:** https://pinaprosek.eu · **Klub:** SK Prosek Praha (+ VK Benátky)

## Struktura

```
api/          PHP 8.5 backend
  src/          Auth, Http, Controller, Service, Support
  tests/        PHPUnit (unit + integrační proti MySQL)
  tools/        migrace ze staré DB a její ověření
  db/           SQL migrace schématu
  public/       index.php — jediný veřejný PHP soubor
web/          React 19 + TypeScript frontend
  src/          app, features, components, lib
  public/       statické soubory kopírované do buildu (.htaccess)
docs/         analýzy a zadání fází
```

Konvence a pravidla projektu jsou v [AGENTS.md](AGENTS.md), podrobnosti k oběma
částem pak v [api/AGENTS.md](api/AGENTS.md) a [web/AGENTS.md](web/AGENTS.md).

## Stack

| Vrstva   | Technologie |
|---|---|
| Frontend | React 19, TypeScript 7, Vite 8, TanStack Query, Tailwind 4, PWA |
| Nástroje | oxfmt (formátování), oxlint |
| Backend  | PHP 8.5, vlastní mikro-framework (Router → Controller → Service), PDO, JWT |
| Databáze | MySQL 8 |
| Hosting  | Czechia / Zoner — Apache + PHP-FPM, deploy přes FTP |

Zdůvodnění voleb je v [technické analýze](docs/ANALYZA-TECHNICKA.md), kapitola 3.

## Vývoj

```bash
docker compose up -d                    # MySQL 8 + PHP 8.5 (shoda s produkcí), API na :8080
cd web && npm install && npm run dev    # frontend na :5173, /api proxy na :8080
```

Backend:

```bash
docker compose run --rm php ./vendor/bin/phpunit
docker compose run --rm php ./vendor/bin/phpstan analyse --memory-limit=512M
```

Frontend:

```bash
cd web
npm run typecheck    # TypeScript 7
npm run lint         # oxlint
npm run format       # oxfmt
npm run build        # → web/dist/
```

Lokální databáze se plní kopií produkčního dumpu, takže migrace i dotazy se testují
proti reálným datům (6 116 zápisů). Dump se do repa **necommituje** — obsahuje osobní údaje.

**Testy běží proti `pina_test`**, nikdy proti vývojové databázi. Hlídá to pojistka
v `DatabaseTestCase`, protože testy si tabulky před během promazávají.

## Nasazení

Hosting nemá SSH, deploy jde přes FTP a rozděluje se na dvě místa:

| Odkud | Kam |
|---|---|
| `api/src`, `api/vendor`, `api/.env` | `/www/sites/8/site92718/app/` — mimo web |
| `api/public/*` | `public_html/api/` |
| `web/dist/*` | `public_html/` |

`open_basedir` sahá nad web root, takže `.env` ani `vendor/` nejsou z internetu dostupné.

Pro Web Push se před nasazením přes `cd api && composer vapid:generate` vytvoří
`VAPID_PUBLIC_KEY` a `VAPID_PRIVATE_KEY`; spolu s `VAPID_SUBJECT` a náhodným
`CRON_TOKEN` se doplní do `api/.env` podle příkladu. Plánovač hostingu pak volá
každých 15 minut jedinou úlohu `POST /api/v1/cron/notifications/send?token=...`,
která založí připomínky na zítřejší akce a odešle frontu.

## Fáze

|     | Obsah | Stav |
|---|---|---|
| F0 | ověření hostingu, dump dat, repo | hotovo |
| F1 | schéma, migrace, auth, role, týmy, sezóny, členové | hotovo |
| F2 | prohřešky — sazebník, dávkový zápis, přehledy | hotovo |
| F3 | docházka, nominace, opakované akce | hotovo |
| F4 | dluhy, platby, QR (SPAYD), cesťáky, pololetí | hotovo |
| F5 | PWA, Web Push, odběr kalendáře (`webcal://`) | hotovo |
| F6 | párování plateb z bankovního API (follow-up) | |

Cíl: F1 + F2 na start sezóny 26/27 (září 2026), pak vypnout starou aplikaci.

Rozhodnutí a bezpečnostní omezení F5 jsou v [docs/F5-PREDANI.md](docs/F5-PREDANI.md).
Aplikaci lze nainstalovat na plochu, spustí se i bez signálu (dál než na
přihlášení se ale bez sítě nedostane) a nová verze se aktivuje až po potvrzení.
Data se do zařízení neukládají. Web Push
posílá jen dvě schválené kategorie podle osobních voleb, přes databázovou frontu
a chráněné cron úlohy. Odběr kalendáře nese oprávnění tajnou adresou
`webcal://`, jejíž otisk lze v profilu zneplatnit.

## Kde to stojí

K 18. 8. 2026 je hotové všechno z F1 a F2: přihlášení a role, družstva a jejich
členové, sezóny se soupiskami, sazebník, dávkový zápis prohřešků, přehled dluhů,
pozvánky a aktivační odkazy e-mailem, obnova zapomenutého hesla a konzole správce
platformy. Světlý i tmavý režim.

Hotová je i celá **F3 — docházka**: kalendář v seznamu i v měsíční mřížce,
jednorázové akce i opakované série (z pravidla „každé úterý a čtvrtek" se vyrobí
všechny termíny do konce sezóny, měnit i mazat je jde od jednoho termínu dál nebo
celé), odpovědi hráčů, domluva odvozů u venkovních zápasů, nominace, ruční opravy
docházky, procenta účasti, správa míst konání a průběžný odběr kalendáře v telefonu
(`webcal://`). Nastavení družstva drží domácí halu, viditelnost docházky a sazbu cesťáků.

Hotová je i **F4 — peníze**: zůstatek skládá prohřešky, bonusy, potvrzené
platby a cesťáky. Pínař může platby i ruční cesťáky zapsat a stornovat, proběhlé
venkovní zápasy se řidičům načtou podle sazby družstva a hráč zaplatí kladný dluh
přes QR ve formátu SPAYD. Číslo účtu se spravuje v nastavení družstva a sdílí ho
celý klub. Kdo zapomněl předem říct, že jede autem, se doplní zpětně v docházce —
stejně jako se opravuje samotná docházka.

**Pololetí se nezavírá, jen zobrazuje.** Sezóna má datum přelomu (předvyplněné na
1. ledna) a podle něj se dluhy, platby i cesťáky rozdělí na podzim a jaro — na
přehledu peněz přepínačem, v kartě hráče dvěma sloupci vedle sebe. Nic se tím
nezamyká, protože zamykání by pínaře jen svazovalo. Cenou za to je, že platba
spadne do toho pololetí, kdy přišla, ne kam patřila: proto QR pořád vyzývá
k celému nedoplatku sezóny a nikde netvrdí, že platí jen jednu polovinu.
Tabulky pro snímek uzávěrky (`settlement`, `settlement_line`) ležely ve schématu
od F1 nevyužité a jsou zrušené — schéma nemá slibovat, co aplikace nedělá.

Tři rozhodnutí, která stojí za připomenutí, protože jdou proti první intuici:

**Docházka se nezapisuje, jen opravuje.** Hráč předem řekne, jestli přijde, a po
začátku akce je z toho docházkový stav; pínař přepisuje jen výjimky. Původní návrh
počítal s odklikáváním celého týmu po každém tréninku — tým to označil za práci,
kterou nikdo dělat nebude.

**Zápis prohřešků se z docházky nabízí, nedoplňuje se sám.** Po vybrání akce se
ukáže, koho a za kolik by to zapsalo, a teprve po potvrzení z toho vznikne obyčejný
rozepsaný zápis. Omluvenou absenci pozná podle toho, že hráč předem řekl „nepřijdu".
Který prohřešek to je, se nehádá z názvu — pínař ho označí v sazebníku, a to zvlášť
pro trénink a zvlášť pro zápas, protože sazby se liší i o stovky korun.

**Doma se necestuje.** Domácí zápas se pozná podle domácí haly družstva a nevzniká
u něj ani vzdálenost, ani domluva odvozů, takže z něj nemůže vzniknout cesťák.

309 testů na backendu, 187 na frontendu, PHPStan level 8 čistý. Část testů
formátu ICS se s jeho generátorem přesunula z TypeScriptu na server.

**Před spuštěním zbývá:**

1. **Nasazení.** Na hostingu pořád běží verze z roku 2023. Deploy zatím nikdo
   neautomatizoval, dělá se ručně přes FTP podle tabulky výš.
2. **Rozeslat aktivační odkazy.** Hesla se ze staré verze nepřenášela (byly to
   SHA-256 otisky bez soli), takže se 90 z 91 účtů nemá čím přihlásit. Rozesílá
   se po družstvech, po 25 zprávách na kliknutí. Začít je potřeba u adminů —
   kadeti ani VK Benátky nemají zatím jediného přihlášeného člena včetně svých.
3. **Zkontrolovat aktuální sezóny.** Kadeti mají označenou „Kadeti 24/25“, dva
   roky starou. Junioři mají 25/26.
4. **Vyzkoušet odběr kalendáře na ostré adrese.** Lokálně to jde jen ručně
   vloženou `http://` adresou: macOS Kalendář si `webcal://` přeloží na
   **https**, a dev server certifikát nemá. Google kalendář navíc načítá adresu
   ze svých serverů, takže na localhost nedosáhne vůbec. Po nasazení tedy ověřit,
   že tlačítko „Přidat do kalendáře" projde na jedno kliknutí — v Apple kalendáři
   i v Google kalendáři. Samotný endpoint je ověřený (hlavičky, `ETag`, 304, 429,
   zneplatnění i to, že ICS neobsahuje osobní data).

VK Benátky jsou v datech cizí živý klub s vlastním adminem. Oddělení od Prosku
drží role na serveru, ne jen UI — správce platformy vidí jejich zdraví, ne peníze.
