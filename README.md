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

Po změně `docker/php/Dockerfile` nestačí `docker compose build` — běžící kontejner
na `:8080` by dál jel na starém obrazu, zatímco `docker compose run` už na novém.
Rozdíl se pak projeví jen v aplikaci, ne v testech:

```bash
docker compose up -d --build --force-recreate php
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
| `api/src`, `api/vendor`, `api/db`, `api/tools`, `api/.env` | `data/app/` — mimo web |
| `api/public/*` | `public_html/api/` |
| `web/dist/*` bez `*.map` | `public_html/` |

Kořen FTP je `/www/sites/8/site92718` a **není zapisovatelný** — ani pro PHP, ani
přes FTP. Aplikace proto nebydlí v `app/` vedle web rootu, jak se původně počítalo,
ale v `data/app/`: ten uživateli webu patří, takže do `storage/images/` jde zapisovat.
`open_basedir` je nastavený právě na kořen FTP, takže `data/app` je pro PHP dosažitelný,
zatímco z internetu vidět není. `.env` se po nahrání zamkne na `chmod 600`.

`index.php` kořen nehledá pevně relativně, ale zkusí `..` (vývoj) a `../../data/app`
(hosting) — vybere první, kde najde `vendor/autoload.php`.

Zdrojové mapy se nenahrávají: service worker je v precache seznamu nemá, takže
jejich vynechání nic nerozbije a nezveřejní zdrojáky.

Závislosti se instalují bez vývojových nástrojů:

```bash
composer install --no-dev --optimize-autoloader
```

**Migrace při prvním nasazení.** MySQL Zoneru je zvenčí nedostupná (práva má
uživatel omezená na IP hostingu) a hosting nemá SSH, takže se `001_init.sql`
ani `tools/migrate_legacy.php` nedá spustit z lokálu. Nasazení proto proběhlo
přes jednorázový skript v `public_html`, chráněný tokenem, který si údaje bral
z `data/app/.env` a po použití se smazal. Stará i nová schémata leží v jedné
databázi `pinaprosek` — hosting druhou nedává a jména tabulek se nekryjí
(`Uzivatel`, `Tym`, … vs. `user`, `team`, …), takže se nic nepřepisuje.
Nástroje v `tools/` píšou do `STDOUT`/`STDERR`, které ve webovém SAPI neexistují;
spouštěč je musel nejdřív nadefinovat.

Nahrané obrázky leží v `api/storage/images/`, tedy **na disku, ne v databázi**.
Adresář musí být zapisovatelný pro PHP a **nesmí se při nasazení přepsat** —
záloha databáze ho neobsahuje, takže po jeho smazání zbydou v tabulkách odkazy
na soubory, které nikde nejsou (aplikace to ustojí, ukáže iniciály). PHP navíc
potřebuje GD **přeložené s JPEG a WebP**; bez toho se nedá nahrát fotka
z telefonu, ověřit to jde `php -r 'print_r(gd_info());'`. Do těla požadavku se
obrázek vejde s rezervou, protože ho prohlížeč zmenší dřív, než ho odešle.

Pro Web Push se před nasazením přes `cd api && composer vapid:generate` vytvoří
`VAPID_PUBLIC_KEY` a `VAPID_PRIVATE_KEY`; spolu s `VAPID_SUBJECT` a náhodným
`CRON_TOKEN` se doplní do `api/.env` podle příkladu. Plánovač hostingu pak volá
každých 15 minut jedinou úlohu `GET /api/v1/cron/notifications/send?token=...`,
která založí připomínky na zítřejší akce a odešle frontu. Že jde o GET, si
vynutil plánovač Zoneru — u úlohy se zadává jen adresa, metoda se nevybírá.

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
přes QR ve formátu SPAYD. Číslo účtu má **každé družstvo vlastní** — původně
leželo na klubu, takže změna u mužů tiše přepsala účet juniorům i kadetům.
Kdo zapomněl předem říct, že jede autem, se doplní zpětně v docházce —
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

Hráči i družstva mají **obrázky**. Profilový obrázek se nastaví v `/ja`, znak
družstva v `/druzstvo`; bez něj se všude kreslí znak klubu. Bere JPEG, PNG,
GIF i WebP; prohlížeč fotku nejdřív zmenší na 1024 px, takže se mobilními daty
netáhne deset megabajtů pro obrázek, ze kterého bude 512 px. Server pak z každého
souboru udělá vlastní PNG — profil se oseká na čtverec, aby vyplnil kolečko
u jména, znak klubu se naopak vepíše celý, protože loga jsou na šířku. Obrázek
je vidět všude u jména: v soupisce, dluzích, docházce, nominaci, dávkách,
platbách i cesťácích. Kdo žádný nemá, má dál iniciály nebo číslo dresu.

320 testů na backendu, 195 na frontendu, PHPStan level 8 čistý. Část testů
formátu ICS se s jeho generátorem přesunula z TypeScriptu na server.

**Nasazeno 20. 8. 2026.** Na `pinaprosek.eu` běží nová verze, stará je smazaná
(záloha celého FTP i databáze je mimo repo). Migrace proběhla nad ostrými daty
a `verify_migration.php` na produkci hlásí, že vše sedí: 91 uživatelů, 118 členství,
8 sezón, 176 soupiskových řádků a 6 116 prohřešků, 165 008 Kč do koruny.
Hosting má PHP 8.5.9 a GD s JPEG i WebP, takže obrázky fungují.

**Před spuštěním zbývá:**

1. **Založit sezónu 26/27** u každého družstva. Migrace označuje jako aktuální
   jen sezónu, která zahrnuje dnešek, a skončené rovnou zavírá — všechny staré
   skončily do 30. 6. 2026, takže po nasazení žádné družstvo aktuální sezónu nemá.
   Ke každé nové sezóně pak nastavit soupisku a zkopírovat sazebník z loňska
   (u mužů je tam 45 položek). Doplnit taky **číslo účtu u každého družstva** —
   bez něj nebude QR a stará aplikace ho nikdy neměla, takže se nemělo co migrovat.
2. **Naplánovat cron.** V administraci hostingu úloha na
   `/api/v1/cron/notifications/send?token=…` každých 15 minut.
3. **Rozeslat aktivační odkazy.** Hesla se ze staré verze nepřenášela (byly to
   SHA-256 otisky bez soli), takže se žádný z 91 účtů nemá čím přihlásit —
   a obnova hesla účty bez hesla zamítá, aby jí nešlo obsadit nepřevzatý účet.
   První odkaz pro správce platformy proto musel vzniknout z jednorázového skriptu;
   dál se rozesílá z aplikace po družstvech, po 25 zprávách na kliknutí.
   Než se rozešle hromadně, **vyprázdnit `MAIL_ALLOWLIST`** — zatím je omezený
   na tři vlastní adresy, takže ostatním by se pošta jen zapsala do logu.
4. **Vyzkoušet odběr kalendáře na ostré adrese.** Lokálně to jde jen ručně
   vloženou `http://` adresou: macOS Kalendář si `webcal://` přeloží na
   **https**, a dev server certifikát nemá. Google kalendář navíc načítá adresu
   ze svých serverů, takže na localhost nedosáhne vůbec. Po nasazení tedy ověřit,
   že tlačítko „Přidat do kalendáře" projde na jedno kliknutí — v Apple kalendáři
   i v Google kalendáři. Samotný endpoint je ověřený (hlavičky, `ETag`, 304, 429,
   zneplatnění i to, že ICS neobsahuje osobní data).

VK Benátky jsou v datech cizí živý klub s vlastním adminem. Oddělení od Prosku
drží role na serveru, ne jen UI — správce platformy vidí jejich zdraví, ne peníze.
