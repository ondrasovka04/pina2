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
docs/         analýzy
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

## Fáze

|     | Obsah | Stav |
|---|---|---|
| F0 | ověření hostingu, dump dat, repo | hotovo |
| F1 | schéma, migrace, auth, role, týmy, sezóny, členové | hotovo |
| F2 | prohřešky — sazebník, dávkový zápis, přehledy | hotovo |
| F3 | docházka, nominace, opakované akce | hotovo |
| F4 | dluhy, platby, QR (SPAYD), cesťáky, pololetí | hotovo |
| F5 | PWA, Web Push | |
| F6 | párování plateb z bankovního API (follow-up) | |

Cíl: F1 + F2 na start sezóny 26/27 (září 2026), pak vypnout starou aplikaci.

## Kde to stojí

K 17. 8. 2026 je hotové všechno z F1 a F2: přihlášení a role, družstva a jejich
členové, sezóny se soupiskami, sazebník, dávkový zápis prohřešků, přehled dluhů,
pozvánky a aktivační odkazy e-mailem, obnova zapomenutého hesla a konzole správce
platformy. Světlý i tmavý režim.

Hotová je i celá **F3 — docházka**: kalendář v seznamu i v měsíční mřížce,
jednorázové akce i opakované série (z pravidla „každé úterý a čtvrtek" se vyrobí
všechny termíny do konce sezóny, měnit i mazat je jde od jednoho termínu dál nebo
celé), odpovědi hráčů, domluva odvozů u venkovních zápasů, nominace, ruční opravy
docházky, procenta účasti, správa míst konání a export do kalendáře v telefonu
(`.ics`). Nastavení družstva drží domácí halu, viditelnost docházky a sazbu cesťáků.

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

281 testů na backendu, 185 na frontendu, PHPStan level 8 čistý.

**Před spuštěním zbývá:**

1. **Nasazení.** Na hostingu pořád běží verze z roku 2023. Deploy zatím nikdo
   neautomatizoval, dělá se ručně přes FTP podle tabulky výš.
2. **Rozeslat aktivační odkazy.** Hesla se ze staré verze nepřenášela (byly to
   SHA-256 otisky bez soli), takže se 90 z 91 účtů nemá čím přihlásit. Rozesílá
   se po družstvech, po 25 zprávách na kliknutí. Začít je potřeba u adminů —
   kadeti ani VK Benátky nemají zatím jediného přihlášeného člena včetně svých.
3. **Zkontrolovat aktuální sezóny.** Kadeti mají označenou „Kadeti 24/25“, dva
   roky starou.

VK Benátky jsou v datech cizí živý klub s vlastním adminem. Oddělení od Prosku
drží role na serveru, ne jen UI — správce platformy vidí jejich zdraví, ne peníze.

## Nápady na později

Věci, které dávají smysl, ale nejsou potřeba ke spuštění. Zapsané schválně
i s tím, proč zatím počkaly.

### Odběr kalendáře (`webcal://`)

Dneska si jde rozpis stáhnout jako soubor `.ics`. Je to **snímek**: když se
trénink přesune, v telefonu zůstane starý čas, dokud si člověk soubor nestáhne
znovu. Odběr je proti tomu adresa, kterou si kalendář sám občas načte, takže se
změna propíše bez zásahu.

Zádrhel je v tom, že **kalendář v telefonu se neumí přihlásit**. Neposílá token
ani neprojde přihlašovacím formulářem — sáhne na adresu a čeká `text/calendar`.
Celé oprávnění tedy musí nést sama adresa, a ta se pak povaluje v nastavení
telefonu a v zálohách. Je to jediná část aplikace, která by byla veřejně
dostupná bez přihlášení, a takovou věc je lepší psát v klidu než v týdnu před
spuštěním.

Co by bylo potřeba:

1. **Tabulka `calendar_feed`** — `user_id`, `team_id`, `season_id`, SHA-256 otisk
   tokenu, `created_at`, `last_used_at`, `revoked_at`. Token se vydá jednou,
   v databázi zůstane jen otisk, stejně jako u pozvánek.
2. **Token na člověka a družstvo**, ne jeden sdílený na tým. Jinak by kalendář
   četl i ten, kdo z družstva dávno odešel.
3. **Veřejný endpoint** `GET /api/v1/calendar/{token}.ics` mimo autentizaci, který
   ověří otisk, odmítne zneplatněný token, **zkontroluje trvající členství**,
   omezí četnost dotazů (adresa je veřejná a kalendáře se ptají po hodinách)
   a posílá `ETag`, aby se nepřenášelo osmdesát akcí pokaždé.
4. **Obsah bez citlivých údajů** — místo, čas, soupeř, sraz. Žádná docházka,
   dluhy ani jména; tenhle soubor může skončit ve sdíleném rodinném kalendáři.
5. **Správa v profilu** — odkaz `webcal://`, který na iOS i Androidu otevře rovnou
   dialog pro přidání, a hlavně možnost odběr **zneplatnit**. Při ztrátě telefonu
   je to jediná obrana.

Odhad je zhruba den práce. Pořadí: **až za cesťáky** — ty řeší skutečné peníze
a vyčistí sazebník mužů, kde je dnes třetina položek pojmenovaná po hráčích.
