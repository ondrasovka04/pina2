# Pína 2.0 — Technická analýza

**Autor:** Ondřej Kopáč
**Původní návrh:** 14. 8. 2026
**Aktualizace:** 17. 9. 2026
**Předchozí verze:** ročníkový projekt 2023 (Expo/React Native + PHP API + MySQL)

---

Aplikace je nasazená na https://pinaprosek.eu. Kapitoly o staré verzi a migraci
popisují historii projektu. Pro současný provoz platí [README](../README.md),
pro úplné schéma [001_init.sql](../api/db/migrations/001_init.sql).
Bankovní párování není rozhodnuté; export plateb, schránka oznámení a platební
brána nejsou v aktuálním rozsahu.

## 1. Výchozí stav

### 1.1 Stav staré verze před přepisem

| Vrstva | Technologie | Stav |
|---|---|---|
| Klient | Expo SDK 50, React Native 0.73, 16 obrazovek, ~5 200 řádků JS | funguje, ale neudržovaný |
| Distribuce | Android APK/AAB (Play Console) + webový build na hostingu | **Play Console účet zrušen** → Android verze je mrtvá |
| API | PHP, ~45 samostatných skriptů, `mysqli`, prepared statements | běží na `https://pinaprosek.eu/api/` |
| Databáze | MySQL na Czechia/Zoner (`pinaprosek.dbaserver.net`) | běží, přístup zachován |
| Hosting | Czechia (Zoner) — Apache, PHP, MySQL, FTP, SSL | běží, ověřeno 14. 8. 2026 |

Databázové schéma: `Uzivatel`, `Tym`, `Sezona`, `UzivatelTym`, `UzivatelSezona`,
`ProhreskySeznam`, `Prohresek` + uložená procedura `prehled`.

### 1.2 Co je na tom špatně

Tohle je seznam důvodů, proč se stará aplikace **přepisuje a neportuje**:

**Bezpečnost (kritické)**
1. Autorizace API je jen HTTP Basic se sdílenými údaji natvrdo zapsanými v klientu.
   Ty údaje jsou ve zdrojáku (`Pina/logins.js`) i v produkčním JS bundlu na webu.
   Kdokoli si otevře `main.*.js`, najde je a může volat libovolný endpoint včetně
   `deleteProhresek.php` nebo `odebraniTymu.php`.
2. `login.php` vrací jen `{"status":"Login successful"}` — **žádný token, žádnou session**.
   Klient si po přihlášení sám nastaví globální proměnnou "jsem admin". Server tedy
   u žádného dalšího požadavku neví, kdo volá a jestli na to má právo. Role existují
   výhradně v UI.
3. Připojovací údaje k DB jsou zkopírované v každém z ~45 PHP souborů.
4. Hesla: SHA-256 bez soli, bez iterací. Slovníkový útok přes rainbow table je triviální.
5. `Access-Control-Allow-Origin: *` na všech endpointech.

**Architektura**
6. Žádná vrstva mezi HTTP a SQL — validace, autorizace i dotaz jsou v jednom souboru,
   copy-paste mezi endpointy. Změna chování = editace 45 souborů.
7. Byznys logika v uložené proceduře `prehled` (~30 řádků SQL s `ROW_NUMBER()`,
   `right outer join` a poddotazy) — netestovatelné, neverzované, těžko změnitelné.
8. Duplicitní obrazovky pro web a nativ (`*.native.js`) kvůli rozdílům RN a RN-Web.
9. Žádné typy, žádné testy, žádný build pipeline.

**Datový model**
10. Částka prohřešku není u zápisu uložena — `Prohresek` odkazuje na `ProhreskySeznam`.
    Když admin změní cenu prohřešku, **přepíše se tím i historie**. Dlužné částky
    v minulých sezónách se zpětně změní.
11. Role je sloupec `Uzivatel.admin` (= id týmu). Uživatel může být adminem právě
    jednoho týmu, hráčem více týmů, a "superadmin" je natvrdo uživatel s `id = 1`.
12. Sezóna má jako primární klíč **textový název** (`varchar(255)`) + `idTym`.
    Přejmenování sezóny je kaskádová změna přes 4 tabulky.
13. Duplicitní název tabulky v dokumentaci (`UzivatelTym` uvedena dvakrát, druhá je
    ve skutečnosti `UzivatelSezona`) — schéma není nikde jednoznačně zapsané.

### 1.3 Co zůstane

- **Hosting Czechia/Zoner** — Apache + PHP + MySQL + FTP + SSL, doména `pinaprosek.eu`.
- **MySQL databáze** — nové schéma vedle starého, všechna data se zmigrují (kapitola 8).
- **PHPMailer** — už je na serveru, poslouží pro pozvánky a reset hesla.
- **Doménový koncept** — tým, sezóna, sazebník prohřešků, zápis prohřešku.

---

## 2. Cílová architektura

```
┌─────────────────────────────────────────────────────────┐
│  Prohlížeč / PWA na mobilu (instalovatelná na plochu)   │
│  React 19 + TypeScript + Vite                           │
│  TanStack Query · React Router · Tailwind · vlastní UI   │
└───────────────────────┬─────────────────────────────────┘
                        │ HTTPS, JSON
                        │ Authorization: Bearer <access JWT>
                        │ Cookie: refresh_token (HttpOnly)
┌───────────────────────▼─────────────────────────────────┐
│  Czechia hosting (Apache + PHP 8.x)                     │
│                                                          │
│  /              → statický build SPA (index.html, /assets)│
│  /api/index.php → front controller, .htaccess rewrite    │
│                                                          │
│     Router → Middleware (auth, role, rate limit)         │
│            → Controller (validace vstupu)                │
│            → Service (byznys logika)  ← zde jsou pravidla│
│            → Support\Database (PDO, prepared statements)       │
└───────────────────────┬─────────────────────────────────┘
                        │ PDO / MySQL
┌───────────────────────▼─────────────────────────────────┐
│  MySQL 8 (Zoner) — nové schéma, InnoDB, utf8mb4          │
└──────────────────────────────────────────────────────────┘

Externí služby:
  · SMTP (Zoner) → pozvánky a reset hesla
  · Web Push (VAPID) → notifikace na mobil
  · Fio banka REST API → jen návrh, realizace není rozhodnutá
  · Mapy → odkazy na navigaci podle místa konání
```

Klíčová změna proti verzi 2023: **server je jediný zdroj pravdy o oprávněních**.
Frontend UI se podle role jen překresluje, ale rozhodnutí "smíš to?" padá v PHP.

---

## 3. Technologie a zdůvodnění

### 3.1 Frontend

| Volba | Proč |
|---|---|
| **React 19 + TypeScript** | Znalost z předchozí verze, typy odstraní celou třídu chyb, které byly v JS verzi |
| **Vite 8** | Build do statických souborů → přesně to, co Czechia hosting umí obsloužit. Rychlý dev server. |
| **React Router 8** | Standardní routing SPA, podpora chráněných rout |
| **TanStack Query v5** | Cache serverového stavu, refetch, optimistické updaty. Nahradí ruční `fetch` + `useState` z RN verze. |
| **Tailwind CSS v4 + vlastní komponenty** | Konzistentní UI a světlý/tmavý režim. |
| **Formuláře v Reactu** | Vlastní stav a validace, server ověřuje vstupy nezávisle. Typy odpovědí jsou v `web/src/lib/types.ts`; runtime validace přes Zod není implementovaná. |
| **vite-plugin-pwa** | Instalace na plochu telefonu, offline shell, Web Push. Nahradí zrušenou Android aplikaci. |
| **Date + Intl** | Datum a formátování na klientovi; PHP používá `DateTimeImmutable` a `Europe/Prague`. |
| **Vitest + Testing Library + MSW** | Unit a integrační testy komponent proti mockovanému API |
| **Ověření v prohlížeči** | Ruční kontrola a příležitostné scénáře přes Playwright; trvalá E2E sada v repozitáři není. |

Proč ne Next.js: hosting neumí Node. Statická SPA je jediná varianta, která na
Czechii poběží bez kompromisu.

Proč ne React Native / Expo: jediný cíl je web, RN-Web přidával duplicitní obrazovky
a omezoval UI. PWA pokryje "aplikace na mobilu" bez Play Console a bez 25 USD poplatku.

### 3.2 Backend

| Volba | Proč |
|---|---|
| **PHP 8.5.9** | Jediné, co hosting nabízí — ale v aktuální verzi (přepnuto z 8.2, security support do 11/2029). Property hooks, asymetrická viditelnost, enums, readonly, typed properties, `pipe` operátor — dá se v tom psát čistě. |
| **Vlastní mikro-framework** (~400 řádků) | Slim/Laravel by šly, ale na sdíleném FTP hostingu bez SSH je menší závislostní strom výhoda. Router + DI kontejner + middleware pipeline se napíše na jeden zátah. |
| **PDO** místo `mysqli` | Prepared statements, named parametry, výjimky místo návratových kódů |
| **firebase/php-jwt** | Podpis a ověření access tokenů |
| **PHPMailer** | Už na serveru je, umí SMTP Zoneru |
| **minishlink/web-push** | Web Push notifikace z PHP (VAPID) |
| **Vlastní validace v Request a controllerech** | Validace vstupů na hranici API |
| **PHPUnit 11** | Testy service vrstvy (byznys pravidla) a repository vrstvy proti testovací DB |
| **PHP-CS-Fixer + PHPStan (level 8)** | Statická analýza — PHP bez typové kontroly je hlavní zdroj chyb ve staré verzi |
| **Vlastní migrační skripty** | Verzované změny schématu; nutné, protože schéma se bude vyvíjet |

**Composer na hostingu bez SSH:** `composer install --no-dev --optimize-autoloader`
se pustí lokálně (nebo v CI) a složka `vendor/` se nahraje přes FTP jako součást
deploye. Zoner nepotřebuje nic instalovat.

### 3.3 Databáze

MySQL 8 na Zoneru, engine InnoDB, kódování `utf8mb4_czech_ci`.

Nové schéma se vytvoří **vedle starého** (prefix `p2_` nebo samostatná databáze,
pokud tarif umožní víc DB). Staré tabulky zůstanou netknuté až do vypnutí staré
aplikace — návrat zpět je pak jen otázka uploadu.

**Ověřeno 14. 8. 2026:** port 3306 je zvenčí filtrovaný — Zoner pouští MySQL pouze
z vlastního hostingu a přes phpMyAdmin. Důsledky: migrace schématu, zálohy i případný
import dat musí běžet **jako PHP skript na serveru**, ne vzdáleným připojením z CI
nebo z vývojářského stroje.

---

## 4. Datový model

Názvy tabulek a sloupců nově **anglicky, `snake_case`** — konzistentní s ORM/nástroji
a bez diakritických nejednoznačností. Doména (UI, dokumentace) zůstává česky.

### 4.1 Přehled

```
club ───── team ──┬── season ──┬── roster_entry ── membership
                  │            ├── offence_type
                  │            ├── event_series ── event ── event_participant
                  │            └── offence_record
                  ├── membership ── user
                  └── team_settings

travel_claim                       (cesťáky)
payment ── bank_transaction        (bank_transaction až s párováním v F6)
invitation / password_reset / refresh_token / audit_log   (infrastruktura)
```

### 4.2 Organizace a lidé

**`club`** — seskupení družstev. Členství, role i peníze jsou oddělené po družstvech.
```sql
id            BIGINT PK AUTO_INCREMENT
name          VARCHAR(120) NOT NULL          -- "SK Prosek Praha"
slug          VARCHAR(60) UNIQUE NOT NULL    -- "sk-prosek" (pro URL)
created_at    DATETIME NOT NULL
```
Klub drží jen identitu. Nic, co se nastavuje — účet ani znak — na něm neleží;
to patří družstvu. Původně tu byl i `status`, ale pozastavený klub nikdo nikdy
nepotřeboval a sloupec by se jen nikdy neplnil.

**`team`** — družstvo v klubu (muži, junioři, kadeti). Klub jich má víc.
```sql
id, club_id FK, name VARCHAR(120),
logo_url VARCHAR(255) NULL,                  -- nahraný znak; bez něj se kreslí klubový
archived_at DATETIME NULL
```

**`user`** — člověk, globálně napříč kluby (jeden účet, víc týmů).
```sql
id            BIGINT PK
email         VARCHAR(190) UNIQUE NOT NULL
display_name  VARCHAR(120) NOT NULL
password_hash VARCHAR(255) NULL              -- NULL = pozvaný účet, heslo si nastaví sám
phone         VARCHAR(13) NULL              -- +420 a devět číslic
avatar_url    VARCHAR(255) NULL
is_platform_admin BOOLEAN DEFAULT FALSE      -- nahrazuje "id = 1"
tokens_valid_from, created_at DATETIME
```

**`membership`** — členství uživatele v týmu **a jeho role v tomto týmu**.
Tohle je jádro nového modelu rolí.
```sql
id, user_id FK, team_id FK
role          ENUM('admin','treasurer','player') NOT NULL   -- admin / pínař / hráč
jersey_number SMALLINT NULL
status        ENUM('active','left') DEFAULT 'active'
joined_at, left_at
UNIQUE (user_id, team_id)
```
Role je **per tým**, ne globální — hráč může být hráčem v týmu mužů a pínařem
u juniorů. Uživatel může mít v jednom týmu právě jednu roli; pokud by bylo potřeba
kombinovat (admin, který je zároveň hráč), řeší se to hierarchií práv, ne dvěma řádky
(admin má implicitně i práva hráče — viz kapitola 5.3).

### 4.3 Sezóny a soupiska

**`season`** — nyní s **umělým číselným PK** (starý model měl textový název jako PK).
```sql
id BIGINT PK, team_id FK, name VARCHAR(60), starts_on DATE, ends_on DATE,
half_year_on DATE NULL,          -- přelom pololetí, viz 4.6
is_current BOOLEAN, closed_at DATETIME NULL
UNIQUE (team_id, name)
```
`closed_at` — uzavřená sezóna je read-only, nejde do ní zapisovat (chybělo ve staré verzi).

**`roster_entry`** — kdo hraje v dané sezóně (dřív `UzivatelSezona`).
```sql
id, season_id FK, membership_id FK, active BOOLEAN DEFAULT TRUE
UNIQUE (season_id, membership_id)
```

### 4.4 Prohřešky

**`offence_type`** — sazebník. Vázaný na **sezónu**, a ta na **tým** → každé družstvo
má vlastní sazebník v každé sezóně, nezávisle na ostatních družstvech téhož klubu.
(Potvrzený požadavek: hráči se mezi družstvy sdílejí, sazebníky ne.)
```sql
id, season_id FK, name VARCHAR(120), amount_czk INT NOT NULL,
sort_order INT, category ENUM('discipline','performance','fun','attendance') NULL,
auto_rule ENUM('none','excused_absence','unexcused_absence','late_rsvp') DEFAULT 'none',
auto_event_type ENUM('any','training','match','other') DEFAULT 'any',
archived_at DATETIME NULL
```
`auto_rule` — nový koncept: prohřešek, který systém navrhne sám z docházky
(neomluvená absence → automaticky navržený zápis, který pínař jen potvrdí).

**Průvodce novou sezónou** umožňuje převzít vybrané položky sazebníku včetně
úpravy cen a vybrat hráče na soupisku. Zápisy, docházka ani platby se nepřenášejí.
Série se zakládají znovu; místa jsou sdílená v klubu, takže kopírování nepotřebují.
Nepokračující hráči zůstávají v `membership` kvůli historii, ale nejsou na nové soupisce.

Průvodce nejprve založí sezónu přes `POST /teams/{team}/seasons`, potom kopíruje
sazebník přes `POST /seasons/{season}/offence-types/copy-from/{source}` a uloží
soupisku přes `PUT /seasons/{season}/roster`. Když převzetí selže, vzniklá sezóna
zůstane zachovaná a uživatel dostane informaci, co se nepovedlo dokončit.

### 4.5 Docházka (nová oblast)

**`event_series`** — opakovaná akce (trénink každé úterý 19:00).
```sql
id, season_id FK, title VARCHAR(120), type ENUM('training','match','other'),
rrule VARCHAR(255)          -- iCalendar RRULE, např. FREQ=WEEKLY;BYDAY=TU,TH
start_time TIME, duration_min SMALLINT,
location_id FK NULL, meet_before_min SMALLINT NULL,   -- sraz X minut předem
default_note TEXT NULL,
active_from DATE, active_to DATE
```

**`location`** — místo konání, sdílené mezi akcemi.
```sql
id, club_id FK, name VARCHAR(120),           -- "Hala Prosek"
address VARCHAR(255),                        -- "Litoměřická 987/1, Praha 9"
lat DECIMAL(9,6) NULL, lng DECIMAL(9,6) NULL,
note VARCHAR(255) NULL                       -- "vchod ze dvora, šatna 3"
```
Souřadnice se geokódují jednorázově přes Nominatim (OSM, zdarma) při uložení adresy.
Frontend z nich staví univerzální navigační odkaz:
`https://www.google.com/maps/dir/?api=1&destination=<lat>,<lng>` (funguje v Google Maps,
na iOS lze nabídnout i `maps://` a Waze). Pokud souřadnice nejsou, fallback na adresu jako text.

**`event`** — konkrétní termín. Vzniká materializací série nebo jednorázově.
```sql
id BIGINT PK, season_id FK, series_id BIGINT NULL FK,
type ENUM('training','match','other'),
title VARCHAR(120),
starts_at DATETIME NOT NULL, ends_at DATETIME NULL,
meet_at DATETIME NULL,                       -- čas srazu
location_id FK NULL,
opponent VARCHAR(120) NULL,                  -- u zápasu
note TEXT NULL,
nomination_opens_at DATETIME NULL,
nomination_deadline DATETIME NULL,
status ENUM('planned','cancelled','done') DEFAULT 'planned',
INDEX (season_id, starts_at)
```
**Materializace série:** z pravidla (`rrule`) se musí vyrobit konkrétní řádky v `event`,
protože nominace, RSVP a docházka se váží vždy na jeden termín — pravidlo je jedno,
termínů je osmdesát.

Série je **vždy ohraničená sezónou**, takže množina termínů je konečná a malá:
2 tréninky týdně × ~40 týdnů = ~80 řádků na sezónu a tým. Proto se **při vytvoření
série vygenerují rovnou všechny termíny do `season.ends_on`** — žádné klouzavé okno,
žádná plánovaná úloha, která by ho posouvala.

Jednotlivou instanci lze upravit (přesunutá hala) nebo zrušit, aniž by se měnila série.

**`event_participant`** — nominace, odpověď hráče i docházka v jednom řádku.

> **Revize po zpětné vazbě od týmu (16. 8. 2026):** původní návrh počítal s tím, že
> pínař po každé akci odklikne docházku všech hráčů. Reakce z týmu byla jednoznačná —
> „to bude strašný oser", který nikdo dělat nebude. Docházka se proto **nezapisuje,
> jen opravuje**.
```sql
id, event_id FK, membership_id FK,
nomination  ENUM('none','nominated','substitute') DEFAULT 'none',  -- jen u zápasů
rsvp        ENUM('unknown','yes','no') DEFAULT 'unknown',          -- co řekl hráč předem
rsvp_note   VARCHAR(255) NULL,
rsvp_at     DATETIME NULL,
attendance  ENUM('present','absent','injured') NULL DEFAULT NULL,  -- NULL = žádná ruční oprava
attendance_by BIGINT NULL FK, attendance_at DATETIME NULL,
transport   ENUM('none','driver') DEFAULT 'none',            -- beru auto, nebo neberu
car_seats   TINYINT NULL,
UNIQUE (event_id, membership_id)
```

**Tok docházky:**
```
hráč předem zaklikne  jdu / nejdu
        │
        ▼
po akci se z toho SÁM stane docházkový stav      ← nikdo nic nedělá
   rsvp='yes' → present,  jinak → absent
        │
        ▼
admin nebo pínař přepíše jednotlivce             ← jen výjimky
   (attendance přestane být NULL a má přednost)
```

Kdo se nezaklikne, počítá se jako nedorazil. Skutečný stav vrací
`COALESCE(attendance, derived_from_rsvp)` — sloupec `attendance` je tedy **záznam
o ruční opravě**, ne o docházce samotné. To je celé kouzlo: bez zásahu člověka
je docházka kompletní a správná ve většině případů.

**Absence se nerozlišuje** na omluvenou a neomluvenou („absence je absence").
Jedinou výjimkou je `injured` — zranění nebo dlouhodobá nemoc, která se nepočítá
do jmenovatele:
```
účast % = present / (present + absent)        ← injured se vynechá úplně
```

**Nominace jen u zápasů.** U tréninků zůstává `none` — nominovat na trénink
bylo vyhodnoceno jako zbytečná byrokracie.

**Viditelnost je nesymetrická** (`team_settings`):

| | Hráč | Pínař | Admin |
|---|:--:|:--:|:--:|
| Dluhy ostatních | ✓ | ✓ | ✓ |
| Vlastní docházka | ✓ | ✓ | ✓ |
| Docházka ostatních | — | ✓ | ✓ |
| Procenta účasti a žebříčky | — | — | ✓ |

Pínař vidí docházku ostatních jen proto, že ji smí opravovat; souhrnné statistiky
jsou výhradně pro admina. Dluhy naopak vidí všichni — „to je prdel".

### 4.6 Cestovní náhrady a pololetí

Vzniklo ze zpětné vazby týmu a z nálezu v datech (viz 8.4): tým mužů si proplácení
cesťáků eviduje jako záporné položky sazebníku pojmenované po jednotlivých hráčích
(„Cesťák 1.pol Vénis" −2 568 Kč). Tři na první pohled nesouvisející požadavky —
cesťáky, „mám auto" a půlroční zúčtování — jsou ve skutečnosti jeden tok:

```
zápas venku ──> kdo jel autem ──> km × sazba ──> nárok hráče ──┐
                                                               │
prohřešky + bonusy ─────────────────────> dluh hráče ──────────┤
                                                               ▼
                                       zúčtování období: kdo komu kolik
```

Proto `event_participant.transport` neslouží jen k domluvě odvozů, ale je zároveň
vstupem pro výpočet náhrady.

**`team_settings`** — obojí je **volitelné na úrovni týmu**: mládežnické družstvo
cesťáky řešit nemusí, tým mužů ano.
```sql
team_id PK, home_location_id FK NULL,
travel_enabled BOOLEAN, travel_rate_czk_km DECIMAL(5,2),
travel_round_trip BOOLEAN DEFAULT 1,
attendance_visible_to_players BOOLEAN DEFAULT 0,
balances_visible_to_players   BOOLEAN DEFAULT 1
```
Je tu i `bank_account` pro QR platby. Původně seděl na `club`, jenže se editoval
v nastavení družstva — změna u mužů tím tiše přepsala účet juniorům i kadetům.
Každé družstvo má vlastní kasu, takže i vlastní účet.

**`travel_claim`** — nárok na náhradu za cestu vlastním autem.
```sql
id, season_id FK, membership_id FK, event_id FK NULL, occurred_on DATE,
distance_km SMALLINT, rate_czk_km DECIMAL(5,2),   -- snapshot sazby
amount_czk INT, note VARCHAR(255) NULL, created_by FK NULL, voided_at
```

Pravidla (potvrzená týmem 16. 8. 2026):
- **Nárok má výhradně řidič** (`event_participant.transport = 'driver'`).
  Spolujezdci nedostávají nic. Původní návrh k tomu měl třetí stav „svezu se"
  (`passenger`) a počet svezených (`travel_claim.passengers`) — obojí je zrušené.
  Stav `passenger` se v celé aplikaci nikde nelišil od `none`: nikdo ho
  nezobrazoval ani nepočítal, takže dvě hodnoty se stejným následkem jen nutily
  hráče vybírat mezi „nejedu autem" a „svezu se" bez rozdílu. Zůstalo **beru
  auto / neberu auto**.
- **Pouze zápasy.** U tréninků náhrada nevzniká; ruční doplnění zůstává možné
  pro výjimky (turnaj, soustředění).
- **Vzdálenost = domácí hala → hala soupeře.** Bere se z `team_settings.home_location_id`
  a `event.location_id`; `event.distance_km` drží jednosměrnou hodnotu.
- **Výchozí výpočet:** `amount = distance_km × 2 × rate` (cesta tam i zpět).
  Přepínač `team_settings.travel_round_trip` umožní počítat jen jeden směr.

Sazba se ukládá jako snapshot — pozdější zdražení nepřepíše už vyúčtované období.

**Pololetí — jen členění podle data, žádná uzávěrka.** Původní návrh měl tabulky
`settlement` a `settlement_line`: snímek zúčtovacího období, který po uzavření
nešlo změnit zpětnou úpravou sazebníku ani doplněným zápisem. Ležely ve schématu
od F1 nevyužité a při dokončování F4 je tým **odmítl** — zamykání by pínaře jen
svazovalo, protože zápis za trénink dorazí i týden pozdě. Tabulky jsou zrušené;
schéma nemá slibovat, co aplikace nedělá.

Místo nich má sezóna jediný sloupec:
```sql
season.half_year_on DATE NULL   -- přelom pololetí; NULL = pololetí se neřeší
```
Předvyplní se na 1. ledna, protože volejbalová sezóna běží přes Nový rok. Podle
něj se prohřešky, platby i cesťáky rozdělí na dvě poloviny — na přehledu peněz
přepínačem, v kartě hráče dvěma sloupci vedle sebe. Nic se nezamyká.

Cenou za to je nepřesnost, kterou je potřeba přiznat: **platba spadne do toho
pololetí, kdy přišla, ne kam patřila.** Bez uzávěrky se totiž nedá poznat, které
pololetí měla lednová platba zaplatit. Proto QR kód vyzývá k celému neuhrazenému
zůstatku sezóny a nikde netvrdí, že platí jen jednu polovinu — text nesmí slibovat
něco jiného, než co se strhne.

Obousměrnou pokladnou se pína stává i tak: cesťák je záporná položka, takže
aplikace dosud uměla jen vybírat, nově i proplácet.

### 4.7 Platby

**`payment`** — úhrada píny.
```sql
id, season_id FK, membership_id FK,
amount_czk INT NOT NULL, paid_on DATE NOT NULL,
method ENUM('cash','transfer','qr') NOT NULL,
variable_symbol VARCHAR(10) NULL,
bank_transaction_id BIGINT NULL FK,          -- vyplněno při automatickém párování
confirmed_by BIGINT FK user, note VARCHAR(255) NULL, created_at
```

**`bank_transaction`** — importovaný bankovní pohyb (fáze 2).
```sql
id, club_id FK, external_id VARCHAR(64) UNIQUE,   -- id z Fio API → idempotence importu
amount_czk INT, currency CHAR(3), booked_on DATE,
variable_symbol VARCHAR(10) NULL, counterparty_account VARCHAR(50) NULL,
message VARCHAR(255) NULL, raw_json JSON,
matched_payment_id BIGINT NULL, matched_at DATETIME NULL,
status ENUM('unmatched','matched','ignored') DEFAULT 'unmatched'
```

Stav konta hráče je **odvozený**, ne uložený:
`dluh = Σ offence_record.amount_czk (nevoidované) − Σ payment.amount_czk`.
Pro rychlost lze později přidat materializovaný `balance_cache` s invalidací.

**Variabilní symbol:** každé členství dostane stabilní VS při vytvoření —
`membership.payment_reference` (8 číslic, `team_id` prefix + pořadí + kontrolní číslice
modulo 11). Hráč platí pořád stejný VS, párování je pak jednoznačné.

### 4.8 Infrastrukturní tabulky

```
refresh_token   (id, user_id, token_hash, expires_at, revoked_at, created_at)
invitation      (id, team_id, email, role, token_hash, expires_at, accepted_at, invited_by, created_at)
password_reset  (id, user_id, token_hash, expires_at, used_at, created_at)
login_attempt   (id, email, ip, created_at)          -- rate limiting
calendar_feed   (id, user_id, team_id, season_id, token_hash, created_at, last_used_at, revoked_at)
audit_log       (id, team_id, actor_user_id, action, entity, entity_id, payload JSON, created_at)
push_subscription (id, user_id, device_id, endpoint, endpoint_hash, p256dh, auth, content_encoding, created_at, last_seen_at, failed_at)
notification_pref (user_id, channel, event_type, enabled)
notification      (id, user_id, type, title, body, link, dedupe_key, created_at)
notification_queue(id, notification_id, push_subscription_id, status, attempts, last_error, send_after, locked_at, sent_at)
```

`notification` je jedna zpráva pro jednoho člověka a `dedupe_key` v ní hlídá, že
stejná událost nedorazí dvakrát; `notification_queue` je odesílací fronta
s opakováním — selhání push serveru nesmí shodit zápis prohřešků.

Přehled oznámení v aplikaci není plánovaný. `notification` slouží doručování
push a deduplikaci; `read_at` a `payload` byly odstraněny. Fronta má pouze push,
proto nepotřebuje vlastní sloupec `channel`. Ponechanou rezervou je jen
`bank_transaction` a vazba z platby — o bankovním párování není rozhodnuto.

`audit_log` zachycuje citlivé změny peněz, oprávnění, sazebníku a sezón.
Váže se na družstvo, zapisuje se ve stejné transakci jako změna a čte ho jen
admin daného družstva. Payload drží identifikátory a snapshoty hodnot, ne
kopie osobních údajů ani tokeny.

### 4.9 Automatický úklid provozních dat

`MaintenanceService::cleanup` se spouští po odesílání ve stávající chráněné úloze
`GET /api/v1/cron/notifications/send?token=…`, každých 15 minut. Nevyžaduje vlastní
plánovač, zapnuté push ani změnu schématu. Běží také během nočního klidu, kdy se
oznámení neposílají. Kontrola `CRON_TOKEN` předchází odesílání i mazání.

Rezerva je **365 dní**, definovaná v `MaintenanceService::RETENTION_DAYS`.
Stáří se porovnává striktně s hranicí v časové zóně `Europe/Prague`; záznam přesně
na hranici ještě zůstává. Rozhoduje konec platnosti a níže uvedené podmínky,
nikoli jen datum vytvoření tokenu.

| Záznam | Podmínky smazání |
|---|---|
| `refresh_token` | `expires_at` je starší než 365 dní; `revoked_at` je prázdné nebo také starší. |
| `password_reset` | `expires_at` je starší než 365 dní; případné `used_at` rovněž. |
| `invitation` | `expires_at` je starší než 365 dní; případné `accepted_at` rovněž. Účet ani členství se nemažou. |
| `calendar_feed` | `revoked_at` je starší než 365 dní. Platný, i dlouho nevyužitý odběr zůstává. |
| `notification_queue` | Jen `sent` se starým `sent_at`, nebo `failed` bez `sent_at`; `send_after` i datum zprávy jsou starší než 365 dní, `locked_at` je prázdné. |
| `notification` | Vytvořena před více než 365 dny a nemá už žádné doručení ve frontě, ani pro jiné zařízení. |

U neúspěšného doručení schéma nemá datum dokončení, proto je jeho časovým vodítkem
`send_after` (poslední plánovaný pokus) spolu se stářím zprávy. Čerstvé úspěšné
doručení staré zprávy se díky `sent_at` uchová další rok. Čekající a právě
zpracovávané zprávy se nemažou. Nejdřív se uklízí dokončená doručení, až potom
zprávy bez fronty — mazání zprávy nesmí kaskádou zrušit čekající doručení.
Smazáním zprávy končí také uchování jejího deduplikačního klíče.

Každý běh odstraní nejvýš **500 řádků z každé ze šesti tabulek**. Další dávka
počká na příští cron; opakované spuštění je bezpečné. Jednotlivé příkazy jsou
samostatné, takže případný nedokončený běh příště pokračuje zbývajícími záznamy.
Odpověď má `Cache-Control: no-store` a pole `cleanup` s počty
`refreshTokens`, `passwordResets`, `invitations`, `calendarFeeds`,
`notificationDeliveries` a `notifications`. Neobsahuje tokeny ani osobní údaje.

Úklid nemaže účty, členství, soupisky, finanční historii, audit, platné push odběry
ani osobní preference. `login_attempt` má nadále samostatnou 24hodinovou retenci
v `RateLimiter`; roční rezerva se na něj nevztahuje. Čtení a použití tokenů se
nemění, včetně detekce znovupoužití zneplatněných refresh tokenů během jejich retence.

---

## 5. Autentizace a autorizace

### 5.1 Přihlášení

1. `POST /api/v1/auth/login` — email + heslo.
2. Server ověří heslo přes `password_verify()` (Argon2id, fallback bcrypt).
   Stará SHA-256 hesla se nikam nepřenášejí — každý si nastaví nové z pozvánky
   (viz kapitola 8).
3. Odpověď: `access_token` (JWT, platnost 15 min, v těle odpovědi) +
   `refresh_token` (opaque, 30 dní, **HttpOnly + Secure + SameSite=Strict cookie**,
   v DB uložen jen jako hash).
4. `POST /api/v1/auth/refresh` — rotace refresh tokenu (starý se zneplatní).
   Detekce znovupoužití zneplatněného tokenu → odhlášení všech relací uživatele.

Access token v paměti JS (ne v `localStorage`) — omezuje dopad XSS.

**JWT payload:**
```json
{
  "sub": 42, "email": "...", "name": "...",
  "memberships": [ {"team": 1, "club": 1, "role": "treasurer"} ],
  "platform_admin": false,
  "iat": ..., "exp": ...
}
```
Role jsou v tokenu kvůli rychlosti UI, ale **server je při každém zápisu ověřuje znovu
proti DB** — token je nápověda, ne důkaz.

**Rate limiting:** 5 pokusů / 15 min na kombinaci e-mail + IP (tabulka `login_attempt`),
pak exponenciální zpoždění. Bez toho je login na sdíleném hostingu volně brute-forcovatelný.

### 5.2 Onboarding uživatele

Hráče nezakládá sám sebe (nechceme veřejné registrace do cizích týmů):
1. Admin týmu pozve hráče e-mailem → `invitation` s jednorázovým tokenem (72 h).
2. Hráč klikne, nastaví heslo (min. 10 znaků, kontrola proti seznamu nejčastějších
   hesel, žádná nesmyslná pravidla typu "musí obsahovat číslici").
3. Účet se propojí s existujícím `user`, pokud e-mail už v systému je
   (hráč ve dvou klubech = jeden účet).

Nový klub: samostatný formulář "založit klub", zakladatel se stává adminem.
Pro start může být za schválením platform admina (tebe), aby systém nezaplevelili roboti.

### 5.3 Matice oprávnění

| Akce | Hráč | Pínař | Admin týmu | Platform admin |
|---|:--:|:--:|:--:|:--:|
| Vidět svůj přehled prohřešků a dluh | ✓ | ✓ | ✓ | ✓ |
| Vidět přehled celého týmu | ✓ | ✓ | ✓ | ✓ |
| Vidět kalendář a detail akce | ✓ | ✓ | ✓ | ✓ |
| Zaklikat účast (RSVP) a „jedu autem" | ✓ | ✓ | ✓ | — |
| Vidět vlastní docházku a účast | ✓ | ✓ | ✓ | ✓ |
| Vidět docházku spoluhráčů | — | ✓ | ✓ | ✓ |
| **Vidět procenta účasti a žebříčky** | — | ✓ | ✓ | ✓ |
| **Zapsat / stornovat prohřešek** | — | ✓ | ✓ | — |
| **Označit platbu jako přijatou** | — | ✓ | ✓ | — |
| Zadat cestovní náhradu za jiného | — | ✓ | ✓ | — |
| Opravit docházku u akce | — | ✓ | ✓ | — |
| Vytvořit / upravit akci, sérii, místo | — | ✓ | ✓ | — |
| Sestavit nominaci (jen zápasy) | — | — | ✓ | — |
| **Spravovat sazebník prohřešků** | — | ✓ | ✓ | — |
| Měnit soupisku sezóny | — | ✓ | ✓ | — |
| Založit a uzavřít sezónu, přelom pololetí | — | — | ✓ | — |
| Pozvat hráče, měnit role, pozastavit | — | — | ✓ | — |
| Nastavení klubu, bankovní účet | — | — | ✓ | — |
| Zakládat a mazat kluby | — | — | — | ✓ |

Hierarchie: `admin ⊃ treasurer ⊃ player`. Admin tedy nepotřebuje druhou roli, aby si
mohl zapsat vlastní prohřešek.

Za povšimnutí stojí nesymetrie u docházky a peněz. **Dluhy jsou veřejné všem**
(„to je prdel"), zatímco **docházka ostatních je pro hráče neviditelná** a souhrnná
procenta vidí jen admin. Tohle není technické rozhodnutí, ale explicitní přání týmu —
pína je legrace, docházka je citlivější věc.

**Provoz patří pínaři, účty adminovi.** Pínař zapisuje, spravuje sazebník — je to
on, kdo rozhoduje, co a za kolik se vybírá — a zároveň plánuje: zakládá akce
a série, spravuje místa a mění soupisku sezóny. Admin oproti tomu zve hráče, mění
role, zakládá a uzavírá sezóny a určuje, kdo pínařem je.

Hranice se v F4 posunula. Původně směl akce zakládat jen admin, ale v praxi to je
tentýž člověk, který po tréninku zapisuje — a když se pínař k plánování nedostal,
nemohl ani zapsat, k čemu se prohřešek váže. Nominace zůstala adminovi: sestava
na zápas je něco jiného než rozpis tréninků.

**Vynucení v kódu** — middleware, ne `if` roztroušené po controllerech:
```php
$router->post('/api/v1/seasons/{seasonId}/offences',
    [OffenceController::class, 'store'])
    ->middleware(new RequireRole(Role::Treasurer, scope: SeasonScope::class));
```
`SeasonScope` odvodí z `seasonId` tým a ověří, že volající má v **tomto** týmu
dostatečnou roli. Tím se řeší i tenant izolace — hlavní bezpečnostní riziko
multi-tenant aplikace (IDOR: "změním v URL id a vidím cizí klub").

---

## 6. API

REST, verzované, JSON, jeden front controller.

Níže je **výběr, ne úplný seznam** — hotových tras je přes šedesát a jediný
závazný přehled je `api/src/App.php`. Co se nakonec nepostavilo, je označené,
aby seznam nevypadal jako slib.

```apache
# /api/.htaccess
RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-f
RewriteRule ^ index.php [QSA,L]
```

```
POST   /api/v1/auth/login | refresh | logout
POST   /api/v1/auth/password/forgot | reset
POST   /api/v1/invitations/accept              -- token v těle, ne v adrese
GET    /api/v1/me

GET    /api/v1/clubs/{club}/teams
POST   /api/v1/teams/{team}/members            -- pozvánka
PATCH  /api/v1/memberships/{id}                -- role, pozastavení
GET    /api/v1/teams/{team}/seasons
POST   /api/v1/teams/{team}/seasons
PATCH  /api/v1/seasons/{id}                    -- vč. uzavření

GET    /api/v1/seasons/{s}/offence-types
POST   /api/v1/seasons/{s}/offence-types
PATCH  /api/v1/offence-types/{id}
GET    /api/v1/seasons/{s}/offences?member=&from=&to=
POST   /api/v1/seasons/{s}/offence-batches     -- dávkový zápis, idempotentní (client_uuid)
GET    /api/v1/offence-batches/{id}            -- detail dávky (rozpis pro hráče i pínaře)
POST   /api/v1/offence-batches/{id}/void       -- storno celé dávky
POST   /api/v1/offences/{id}/void              -- storno jednoho zápisu

GET    /api/v1/seasons/{s}/events?from=&to=    -- kalendář
GET    /api/v1/calendar/{token}.ics             -- veřejný odběr, token je oprávnění
GET    /api/v1/me/calendar-feeds                -- vlastní aktivní odběry
POST   /api/v1/seasons/{s}/calendar-feed        -- vydá tajnou adresu jednou
DELETE /api/v1/calendar-feeds/{id}              -- zneplatnění odběru
POST   /api/v1/seasons/{s}/events
POST   /api/v1/seasons/{s}/event-series
PATCH  /api/v1/events/{id}
PUT    /api/v1/events/{id}/nominations         -- hromadná nominace
PUT    /api/v1/events/{id}/rsvp                -- odpověď hráče (jen za sebe)
PUT    /api/v1/events/{id}/attendance          -- zápis docházky
GET    /api/v1/seasons/{s}/attendance          -- procenta účasti

GET    /api/v1/seasons/{s}/balances            -- kdo kolik dluží
POST   /api/v1/seasons/{s}/payments
GET    /api/v1/memberships/{id}/payment-qr     -- SPAYD řetězec pro QR

GET    /api/v1/me/notifications/settings
PUT    /api/v1/me/notifications/preferences
POST   /api/v1/push/subscribe
POST   /api/v1/push/unsubscribe
GET    /api/v1/cron/notifications/send?token=...
```

**Jednotný tvar chyby** (starý systém vracel 400 na všechno):
```json
{ "error": { "code": "SEASON_CLOSED",
             "message": "Sezóna je uzavřená, zápis nelze provést.",
             "details": { "seasonId": 12 } } }
```
Kódy: `400` validace, `401` chybí/expirovaný token, `403` nedostatečná role,
`404` neexistuje nebo nemáš přístup (nerozlišovat — jinak API prozrazuje cizí id),
`409` konflikt, `422` sémantická chyba, `429` rate limit.

**Typy API:** PHP tvary popisují anotace pro PHPStan, TypeScript má odpovídající
rozhraní v `web/src/lib/types.ts`. OpenAPI ani generování typů není implementováno.
Změny payloadů musí upravit obě strany a příslušné testy.

---

## 7. Klíčová doménová logika

### 7.1 Generování opakovaných akcí
Série drží týdenní pravidlo opakování. Všechny termíny se materializují **najednou při vytvoření série**,
až do `season.ends_on` (řádově desítky řádků — viz 4.5). Nepotřebuje to plánovanou úlohu.

Při změně série rozsah `following` oddělí sérii od zvoleného data dál,
`all` upraví i minulé termíny. Akce na stejném datu se upraví a zachovají odpovědi;
změněná data termínů vedou ke smazání a založení akcí. Ručně upravené termíny
(`overridden`) se přeskočí. Podrobná pravidla jsou v `api/AGENTS.md`.

Cron hostingu každých 15 minut obsluhuje push frontu a připomínky nezodpovězených
akcí. Import banky, upomínky dluhů ani vlastní zálohovací úloha implementované nejsou.

### 7.2 Automatické prohřešky z docházky
Pínař si u akce načte návrhy podle výsledné docházky, odpovědi hráče a nastavení
sazebníku (`auto_rule` + `auto_event_type`). Návrhy pokrývají omluvenou a neomluvenou
absenci i pozdní odpověď (`rsvp_late`). Pozdní příchod z nich odvodit nelze.
Zápis vždy potvrzuje člověk, docházka se samostatně neuzavírá.

### 7.3 Dávkový zápis prohřešků: souhrn před odesláním a oznámení

Nejpoužívanější tok celé aplikace. Pínař po tréninku nebo turnaji nasází prohřešky
celému týmu naráz — a než se to odešle, musí vidět **přehledný souhrn toho, co se stane**.
Zápis se týká cizích peněz, takže „odesláno omylem" je reálný a nepříjemný scénář.

**Průběh**

1. **Draft** — pínař vybere akci (nebo jen datum a název, „Turnaj Kbely") a proklikává
   hráče × prohřešky. Draft žije v klientu, průběžně se ukládá do `localStorage`
   → zavření prohlížeče nebo vybitý telefon neznamená ztrátu půlhodiny práce.
2. **Souhrn** — samostatná obrazovka před potvrzením:
   - hlavička: akce, datum, počet dotčených hráčů, **celková částka**,
   - položkově po hráčích: jméno, jednotlivé prohřešky s počty a cenami, součet za hráče,
   - **nový dluh hráče po zápisu** (dosavadní + tento) — pínař hned vidí,
     komu se to vyšplhalo,
   - zvýraznění neobvyklého: hráč s částkou výrazně nad průměrem dávky, hráč, který
     na akci nebyl přítomen, duplicitní zápis stejného prohřešku ve stejný den,
   - z každé položky **jde jedním klepnutím zpět do editace**,
   - přepínač „poslat hráčům oznámení" (výchozí zapnuto).
3. **Odeslání** — jeden `POST` s celou dávkou včetně `client_uuid`.
   Server ji zapíše **v jedné transakci** — buď projde všechno, nebo nic.
   Opakované odeslání téhož `client_uuid` vrátí původní výsledek, nezaloží duplikát.
4. **Potvrzení** — výsledek dávky s odkazem „stornovat celou dávku" (dostupné i později
   z historie zápisů).

Souhrn počítá **frontend** z draftu a sazebníku, který už má načtený — žádné volání
serveru navíc, funguje i na mizerném signálu v hale. Server data při zápisu validuje
znovu (ceny, oprávnění, uzavřená sezóna); pokud se mezitím změnil sazebník, vrátí `409`
s rozdílem a klient souhrn přepočítá.

**Oznámení hráčům**

Notifikace se posílá **agregovaně za dávku, jedna na hráče** — ne jedna na každý
prohřešek. Pět zpráv během deseti vteřin je důvod, proč si lidé notifikace vypnou.

> **Nový zápis do píny**
> V píně máš nový zápis.

Klepnutí otevře aplikaci. Na zamčené obrazovce není částka ani cizí jméno.
Kanálem je **Web Push** pro ty, kdo si ho na daném zařízení povolili;
e-mailový fallback pro tyto kategorie povolený není.

Každý uživatel si v nastavení volí, co chce dostávat (`notification_pref`).
Doménový zápis založí notifikaci a frontu ve stejné databázové transakci,
ale cizí push službu volá až cron. Její selhání proto nemůže shodit zápis.

Povolené kategorie jsou jen dvě: připomínka nezodpovězené akce a nový zápis
do píny. Upomínka dluhu se zrušila 18. 8. 2026 — vybírá se jednou za pololetí,
takže měsíční zpráva připomínala něco, s čím hráč nic dělat nemá, a kdo pořád
nezaplatil, se řeší v týmovém chatu. Nominace mezi nimi není — aplikace nemá krok
„sestava je hotová" a výchozí stav je „jede celá soupiska", takže by oznámení
nenesla informaci; zrušila se 18. 8. 2026, viz `NotificationService::PREFERENCES`.

### 7.4 QR platba (fáze 1, nulové náklady)
Backend složí SPAYD řetězec (standard ČBA, čitelný všemi českými bankami):
```
SPD*1.0*ACC:CZ6508000000192000145399*AM:250.00*CC:CZK*X-VS:10420037*MSG:Pina podzim 2026
```
Frontend ho vykreslí do QR (knihovna `qrcode`). Hráč naskenuje v bankovní
aplikaci, částka i VS jsou předvyplněné. Pínař pak platbu odklikne.
**Náklady: 0 Kč. Bez smlouvy, bez KYC, bez API.**

### 7.5 Automatické párování plateb (follow-up, mimo hlavní rozsah)

> **Rozsah:** tohle je **návrh samostatného modulu bez rozhodnutí o realizaci** a nic dřívějšího na něm nestojí.
> Platební cyklus je kompletní už po F4 — dluh se spočítá, hráč zaplatí přes QR,
> pínař úhradu odklikne. Párování jen odstraňuje ten poslední ruční krok.
>
> **Jediná věc, kterou je potřeba udělat dřív** (a je levná): zavést už v F1
> stabilní `membership.payment_reference` (VS). Když se doplní až s tímto modulem,
> budou mít hráči rok platby bez VS nebo s náhodným, a jeho pozdější změna znamená,
> že si všichni musí přepsat uložené platby v bankovní aplikaci. Zavedený od začátku
> funguje párování zpětně i na historii.
Import z **Fio banka REST API** (`/v1/rest/last/{token}/transactions.json`),
token je read-only, zdarma, bez smlouvy navíc.

Algoritmus párování:
1. Import transakcí, deduplikace přes `external_id` (idempotentní — opakovaný import
   nic nezduplikuje).
2. Kandidáti podle přesné shody `variable_symbol` → `membership.payment_reference`.
3. Kontrola částky: přesná shoda → auto-match. Nižší → částečná úhrada. Vyšší → přeplatek
   na konto.
4. Bez VS: fuzzy shoda podle jména z `message`/protiúčtu (Levenshtein) → **návrh
   k potvrzení**, nikdy auto.
5. Nespárované zůstávají ve frontě pro pínaře s možností ručního přiřazení.

Diplomově zajímavé části: idempotence importu, řešení částečných a duplicitních plateb,
rekonciliace (souhlas zůstatku aplikace vs. banky), audit trail, testovatelnost
(mock Fio odpovědí ve fixtures).

**Platební brána** (Comgate ~1–2 % + paušál, GoPay podobně, Stripe 1,4 % + 6 Kč bez
paušálu) — architektura ji připraví jako `PaymentProvider` rozhraní vedle
`ManualProvider` a `QrProvider`, ale v MVP se neaktivuje. Pro pínu 20–50 Kč
je poplatek proporčně vysoký a přibude účetní a smluvní režie. Doporučení:
implementovat jako volitelný modul až po zprovoznění bankovního párování — dá se
demonstrovat v sandboxu bez ostrého provozu.

---

## 8. Migrace dat

**Rozhodnutí (16. 8. 2026): migruje se všechno.** Hesla jsou jedinou výjimkou —
ta se nepřenášejí, každý si nastaví nové z pozvánky.

### 8.1 Co v databázi skutečně je

Rozbor dumpu z 16. 8. 2026 — **aplikace je v aktivním provozu**, nikoli opuštěná:

| Tabulka | Řádků |
|---|---:|
| `Tym` | 4 (Prosek junioři / kadeti / muži + **VK Benátky**) |
| `Sezona` | 8 (od 22/23 po 25/26) |
| `Uzivatel` | 91 |
| `UzivatelTym` | 117 |
| `UzivatelSezona` | 176 |
| `ProhreskySeznam` | 262 |
| `Prohresek` | **6 116** |

| Sezóna | Zápisů | Hráčů se zápisem |
|---|---:|---:|
| 22/23 | 795 | 25 |
| 23/24 | 1 094 | 26 |
| Kadeti 23/24 | 657 | 20 |
| 24/25 | 929 | 24 |
| Kadeti 24/25 | 588 | 27 |
| **25/26** | **2 053** | **48** |

Poslední zápis: **21. 4. 2026**. Sezóna 25/26 je nejaktivnější v historii aplikace.
Přítomnost cizího klubu (VK Benátky) potvrzuje, že multi-tenant je reálný požadavek.

**Historické ceny jsou zachovány.** `ProhreskySeznam` má sloupec `idSezona` — sazebník
je veden zvlášť pro každou sezónu a ceny se mezi sezónami měnily (22 doložených případů,
např. „Červená karta" 50 → 150 Kč mezi 23/24 a 24/25). Migrace uzavřených sezón je tedy
**přesná**, ne odhadovaná. Riziko přepsání historie existovalo jen uvnitř běžící sezóny.

### 8.2 Postup
1. `mysqldump` staré DB → archiv (hotovo, `export/pinaprosek.sql`).
2. Vytvořit nové schéma migračními skripty.
3. Migrační PHP skript — **idempotentní, dávkovaný** (limit 30 s / 128 MB, viz 10.1),
   s mapovací tabulkou `legacy_id → new_id`.

### 8.3 Mapování

| Staré | Nové | Poznámka |
|---|---|---|
| `Tym` | `club` + `team` | 4 týmy → **SK Prosek** jako klub se 3 družstvy (junioři, kadeti, muži), **VK Benátky** jako samostatný klub. Hráči se mezi družstvy sdílejí (jeden `user`, víc `membership`), sazebníky ne. |
| `Uzivatel` | `user` | **`heslo` se nepřenáší** — `password_hash = NULL`, každý dostane pozvánku |
| `Uzivatel.admin` (id týmu) | `membership.role = 'admin'` | |
| `Uzivatel.id = 1` | `user.is_platform_admin = TRUE` | |
| `UzivatelTym` | `membership` (role `player`) | `pozastaven=1` → `status='left'` |
| `Sezona` | `season` | textový PK → nové `id`, název do `name`; sezóny do 25/26 se rovnou uzavřou (`closed_at`) |
| `UzivatelSezona` | `roster_entry` | |
| `ProhreskySeznam` | `offence_type` | `poradi` → `sort_order`, `castka` → `amount_czk` |
| `Prohresek` | `offence_record` | `amount_czk` = **cena z `ProhreskySeznam` téže sezóny** → historicky přesné |
| procedura `prehled` | smazat | logika přechází do PHP service vrstvy + testů |

Prohřešky bez dávky (`batch_id = NULL`) — dávky u historických dat neexistovaly.

### 8.4 Co odhalila reálná data

Migrace byla spuštěna proti kopii produkce (16. 8. 2026) a vyplavala z ní tři věci,
které mění návrh:

**1. Záporné částky se používají masivně — a ve dvou různých významech.**

*Bonusy* (odečet z dluhu za dobrý výkon): „Eso po týmu" −20, „MVP extraligy" −20,
„Vánoce" −200. Sazebník tedy není jen sazebník pokut a UI musí bonus odlišit od
pokuty (barva, znaménko, samostatný součet). `amount_czk` je proto `INT` se znaménkem.

*Platby obcházené přes sazebník:* tým mužů v sezóně 25/26 má 13 položek typu
„Cesťák 1. pol David" (−1 056 Kč), „Cesťák Vénis 2.pol" (−1 528 Kč) — **pro každého
hráče vlastní položku sazebníku**. Protože aplikace neuměla evidovat platby, řeší se
proplácení cesťáků jako záporné prohřešky. Je to přímý důkaz, že evidence plateb (F4)
není nadstandard, ale funkce, kterou si uživatelé stejně museli vynutit oklikou.
Po F4 se tyhle pseudo-položky nahradí záznamy v `payment`.

**2. Stará DB nemá funkční integritu.** Cizí klíče sice existují, ale
`UzivatelSezona.idSezona` odkazuje na `Sezona(id)`, což při složeném primárním klíči
`(id, idTym)` není unikátní — MySQL 8.4 takový dump odmítne naimportovat. Důsledkem
jsou osiřelé záznamy: hráč #74 má 34 zápisů v týmu 1, ale v `UzivatelTym` chybí.
Migrace proto **dopočítává chybějící členství** se statusem `left`, aby se historie
neztratila.

**3. Pět položek sazebníku má prázdnou nebo smazanou sezónu** (`idSezona = ''`, resp.
„21/22"). Nevisí na nich jediný zápis — jde o nedokončené záznamy z UI. Migrace je
vynechává a vypisuje jmenovitě.

### 8.5 Ověření
`tools/verify_migration.php` porovná starou a novou DB: počty řádků, součty částek
po sezónách i po jednotlivých hráčích a integritu nových dat. Návratový kód 1 = rozdíl.

**Výsledek běhu 16. 8. 2026** — vše sedí:

| Sezóna | Zápisů | Částka |
|---|---:|---:|
| 22/23 | 795 | 21 110 Kč |
| 23/24 | 1 094 | 28 680 Kč |
| Kadeti 23/24 | 657 | 12 068 Kč |
| 24/25 | 929 | 16 867 Kč |
| Kadeti 24/25 | 588 | 12 675 Kč |
| 25/26 junioři | 317 | 10 860 Kč |
| 25/26 Benátky | 247 | 17 145 Kč |
| 25/26 muži | 1 489 | 45 603 Kč |
| **celkem** | **6 116** | **165 008 Kč** |

### 8.6 Ochrana osobních údajů
`export/Uzivatel.csv` obsahuje sloupec `heslo` s SHA-256 hashi. Soubor nesmí opustit
lokální stroj a po dokončení migrace se smaže i s archivním dumpem přesunutým
do offline úložiště.

---

## 9. Frontend — struktura a design

### 9.1 Struktura projektu
```
src/
  app/          router, providers, layout, error boundary
  features/
    auth/       login, pozvánka, reset hesla
    offences/   sazebník, zápis, přehledy, storno
    events/     kalendář, detail akce, série, místa, nominace, RSVP a docházka
    balances/   dluhy, QR, potvrzení plateb a cesťáky
    team/       členové, role, nastavení družstva
    seasons/    sezóny a soupiska
    profile/    profil a osobní preference
    admin/      přehled klubů a družstev pro správce
  components/ui vlastní komponenty
  lib/          api klient (fetch wrapper + refresh), auth kontext, formátování
  lib/types.ts  ručně udržované typy API
```

### 9.2 Design
Hlavní cíl podle zadání: **aplikace má vypadat dobře**, ne jen fungovat.

- Mobile-first — reálné použití je telefon v hale, ne notebook.
- Designový systém: barevná paleta odvozená od klubových barev, definovaná jako
  CSS proměnné, světlý i tmavý režim.
- Typografie: jedno písmo (Inter / Geist), 4–5 velikostních stupňů.
- Vzory obrazovek: karta hráče s dluhem, tabulka s lepivým prvním sloupcem,
  bottom sheet pro rychlý zápis na mobilu, prázdné stavy s výzvou k akci.
- Zápis prohřešků: nejpoužívanější obrazovka pínaře → optimalizovat na počet kliknutí
  (hráč → prohřešek → +1 → hotovo, bez modálů navíc), zakončená **souhrnnou obrazovkou
  před odesláním** (viz 7.3) — ta si zaslouží nejvíc designérské péče z celé aplikace,
  protože je to okamžik, kdy se rozhoduje o cizích penězích.
- Přístupnost: kontrast WCAG AA, ovládání klávesnicí, focus stavy, `prefers-reduced-motion`.
- Grafy: účast v čase, podíl prohřešků, žebříček dlužníků — ale střídmě,
  starý koláč s 12 náhodně obarvenými výsečemi je varování.

Na tuhle část se dá nasadit návrh v jednom průchodu (designový systém → komponenty →
obrazovky) a průběžně screenshotovat proti reálnému UI.

### 9.3 PWA a notifikace
- `vite-plugin-pwa`, manifest, ikony, offline shell (jen statické soubory — data se
  do zařízení neukládají, viz `web/AGENTS.md`).
- Instalace na plochu: Android i iOS (16.4+) — nahrazuje ztracenou Play Store distribuci.
- Web Push (VAPID) z PHP přes `minishlink/web-push`:
  - **zapsané prohřešky — jedno agregované oznámení za dávku** (viz 7.3),
  - připomínka nezodpovězené akce večer předem.
  Na iOS funguje push jen pro PWA přidanou na plochu — v UI je potřeba onboarding krok
  "přidat na plochu".
- Odesílání běží z databázové fronty přes cron hostingu; mezi 23:00 a 8:00
  nic neodejde a `404`/`410` odstraní mrtvý odběr.

---

## 10. Nasazení a provoz

### 10.1 Ověřené parametry hostingu (phpinfo, 16. 8. 2026)

Server: Debian, Apache + **PHP-FPM/FastCGI**, HTTP/2, účet `site92718`.
**Verze přepnuta na PHP 8.5.9** (z výchozí 8.2.33) — ověřeno, že stará aplikace
na ní bez problémů běží. Security support 8.5 běží do 11/2029; 8.2 by vypršela
už 12/2026.

**Dostupné a potvrzené na 8.5.9:**

| Co | Význam pro návrh |
|---|---|
| `sodium` | **Argon2id funguje**, není nutný ústupek na bcrypt |
| `pdo_mysql`, `mysqlnd` | PDO vrstva bez omezení |
| `openssl`, `gmp`, `bcmath` | JWT podpis i VAPID pro Web Push |
| `curl` (HTTP/2, TLS 1.3) | volání bankovního API (F6), geokódování |
| `intl`, `mbstring`, `iconv` | české řazení, formátování, diakritika |
| `redis` | rate limiting a fronta notifikací — **ověřit, zda server skutečně běží** |
| `gd`, `zip`, `fileinfo` | avatary, exporty |
| `opcache` (`validate_timestamps=On`, `revalidate_freq=2`) | po FTP deployi se změny projeví do 2 s, netřeba invalidovat |
| `date.timezone = Europe/Prague` | správně |
| `post_max_size` / `upload_max_filesize` = 64 MB | dostatečné |

**Co na 8.5 oproti 8.2 zmizelo** (a proč to nevadí): `memcached` → nahrazuje `redis`;
`imagick` → na zmenšování avatarů stačí `gd`; `mailparse`, `mcrypt`, `imap`, `zstd`,
`lz4`, `msgpack`, `xmlrpc`, `maxminddb` → nepoužíváme.

**Omezení, která formují návrh:**

1. **`disable_functions`** blokuje `exec`, `shell_exec`, `proc_open`, `system`, `popen`, `dl`.
   → **`mysqldump` z PHP volat nelze.** Databázi zálohuje hosting do
   `/data/sqlbackup/` (ověřeno 17. 9. 2026, viz 10.2). Vlastní PHP dumper není implementovaný.
2. **`max_execution_time = 30 s`, `max_input_time = 30 s`, `memory_limit = 128 M`.**
   → migrace 6 116 řádků, generování událostí ze série i záloha musí být **dávkované**
   a odolné vůči přerušení (kurzor / offset, idempotentní kroky). Žádná operace
   nesmí spoléhat na jeden dlouhý běh.
3. **`open_basedir = /www/sites/8/site92718`**, přičemž web root je
   `/www/sites/8/site92718/public_html`.
   → **složka nad web rootem je pro PHP přístupná** — `.env`, `vendor/` i `storage/`
   leží mimo web v `data/app/`; přístup přes FTP je ověřený nasazením.
4. **`log_errors = Off`, `error_log` nenastaven** → chyby se nikam nezapisují.
   Aplikace si musí logovat sama (vlastní handler / Monolog do `storage/logs`).
5. **`phar.readonly = On`** → composer se pouští lokálně, `vendor/` se nahrává přes FTP
   (tak to bylo plánováno).
6. **Výchozí session cookie nastavení je nezabezpečené** (`cookie_httponly=Off`,
   `cookie_secure=Off`, `use_strict_mode=Off`) → parametry cookie nastavovat explicitně
   v aplikaci, nespoléhat na php.ini.
7. **Odchozí pošta** — ověřeno 16. 8. 2026. Doména má nastavený SPF
   (`v=spf1 include:spf-zoner-zmail.zoner.com ~all`) i MX na `*.zoner.com`, v administraci
   je zapnuté „DKIM Zmail" a „SPF Zmail". Ty se ale týkají **Zonerovy mailové služby**,
   ne funkce `mail()` z webhostingu. Aplikace proto posílá přes **SMTP `smtp.zoner.com:465`**
   s účtem `pina@pinaprosek.eu` — jen tak zpráva projde infrastrukturou, kterou SPF pokrývá,
   a dostane DKIM podpis.

   **Stav k 16. 8. 2026 — hotovo:** mailbox `pina@pinaprosek.eu` založen,
   DMARC nastaven na `_dmarc TXT "v=DMARC1; p=none;"`. Bez `rua` záměrně: agregované
   reporty jsou XML archivy, které by se jen hromadily v nečtené schránce. Až bude
   potřeba dohled, přidá se `rua` přes službu, která je převádí na čitelný souhrn
   (např. Postmark DMARC Digest zdarma).

   **Před rozesláním pozvánek zbývá:** doplnit `MAIL_PASSWORD` do `.env`, přepnout
   `MAIL_ENABLED=true` a ověřit doručitelnost na mail-tester.com.
8. `max_input_vars = 1000` — netýká se nás, dávkový zápis jde jako JSON body, ne form fields.

### 10.2 Současný provoz

Aplikace běží na https://pinaprosek.eu, vývoj používá Docker s PHP 8.5 a MySQL 8
plus Vite. Přesné příkazy a cesty nasazení jsou v [README](../README.md).
PHP zdroje, závislosti, konfigurace a obrázky leží v `data/app/` nad `public_html/`.
Frontend a vstupní skript API jsou v `public_html/`. Závislosti a build se připravují
lokálně a nahrají přes FTP. Automatický deploy z GitHub Actions není zavedený.

**Migrace produkční DB:** dočasný PHP skript chráněný heslem, spuštění přes HTTPS
pomocí `curl`, ověření výsledku a okamžité smazání skriptu. Trvalý veřejný migrační
endpoint neexistuje. Úklid rezerv schématu zajišťuje `api/tools/CleanupUnusedSchema.php`;
nejdřív se nasadí nové API, potom se po záloze DB spustí migrace.

**Zálohy — ověřeno 17. 9. 2026:** administrace hostingu potvrzuje pravidelné
zálohování databáze `pinaprosek`. Na FTP v `/data/sqlbackup/` jsou tři denní verze:

| Soubor | Datum poslední změny na FTP | Velikost |
|---|---|---|
| `pinaprosek.gz` | 17. 9. 2026 | 124 932 B |
| `pinaprosek.gz.1` | 16. 9. 2026 | 122 788 B |
| `pinaprosek.gz.2` | 15. 9. 2026 | 114 184 B |

Nejnovější gzip byl načten pouze do paměti a bez chyby rozbalen: SQL má 1 013 761 B,
35 tabulek, obsahuje tabulky i data současné aplikace a značku dokončení dumpu.
Obnova do testovací DB nebyla provedena. Tři dostupné verze potvrzují denní zálohy,
nikoli smluvní retenci nebo případné další kopie mimo FTP. Soubory `pina.gz*` ze
9. 6. 2025 patří jiné databázi a nejsou aktuální zálohou `pinaprosek`.

Vlastní zálohovací úloha v aplikaci není; původní návrh PHP dumperu a 30denní retence
nebyl realizovaný. Zálohování souborů, zejména `storage/images/`, zůstává neověřené
— SQL archiv obrázky neobsahuje. Export plateb není požadovaný.

**Monitoring:** aplikace zapisuje chyby do logu. Sentry ani samostatný monitoring
dostupnosti nejsou v repozitáři nakonfigurované.

---

## 11. Bezpečnost — souhrn opatření

| Riziko staré verze | Opatření v nové |
|---|---|
| Sdílené Basic credentials v JS bundlu | JWT vázaný na uživatele, refresh v HttpOnly cookie |
| Role jen v UI | Autorizace v middleware na serveru, kontrola scope u každého zápisu |
| SHA-256 bez soli | Argon2id; staré hashe se nepřenášejí, každý si nastaví nové heslo z pozvánky |
| DB credentials v každém souboru | `.env` mimo repo i mimo web root |
| `CORS: *` | whitelist konkrétního originu |
| Bez rate limitu | limit na login, reset hesla a pozvánky |
| Bez ochrany proti IDOR | scope middleware ověřující tenant u každého id v URL |
| `DELETE` bez stopy | storno + `audit_log` |
| Zálohy | denní SQL zálohy na FTP ověřeny; zbývá ověřit obnovu a zálohování obrázků |

Navíc: bezpečnostní hlavičky (`Content-Security-Policy`, `X-Frame-Options`,
`Referrer-Policy`, HSTS), validace všech vstupů na hranici API,
prepared statements všude (PDO, žádná konkatenace SQL).

**Ke starému API:** po nasazení nové verze staré endpointy smazat, ne nechat běžet.
Do té doby zvážit dočasné omezení (např. `.htaccess` deny) — protože credentials
sdílené API údaje jsou veřejně čitelné v produkčním JS bundlu a mazací endpointy
jsou dostupné komukoli, kdo je najde.

---

## 12. Testování a kvalita

| Vrstva | Nástroj | Co se testuje |
|---|---|---|
| PHP service | PHPUnit | výpočet dluhu, procenta účasti, generování z RRULE, párování plateb, autorizační pravidla |
| PHP repository | PHPUnit + testovací MySQL | dotazy, tenant izolace |
| PHP statická analýza | PHPStan level 8 | typová správnost bez běhu |
| React komponenty | Vitest + Testing Library + MSW | formuláře, stavy, role-based UI |
| Kontrola v prohlížeči | ručně / příležitostně Playwright | hlavní uživatelské scénáře; bez trvalé E2E sady |
| Migrace | vlastní kontrolní skript | shoda počtů a součtů se starou DB |

Prioritně testovat: **peníze a autorizaci**. Chyba v procentu účasti je nepříjemná,
chyba v dluhu nebo v izolaci klubů je konec důvěry v aplikaci.

---

## 13. Provozní omezení a otevřené otázky

- Hosting nemá SSH ani vzdálený MySQL; nasazení a migrace používají postup z README.
- PHP a TypeScript typy se udržují souběžně, kompatibilitu ověřují testy.
- Denní DB zálohy jsou ověřené na FTP. Zbývá ověřit obnovu, garantovanou retenci
  a zálohování obrázků; na FTP jsou viditelné tři denní verze databáze.
- O napojení na banku není rozhodnuto. Případný poskytovatel a oprávnění k účtu
  se budou řešit až s tímto rozhodnutím.

Klub může mít více družstev. Členství a oprávnění jsou po družstvech, viditelnost
cizích dluhů a docházky řídí nastavení družstva. Správce aplikace může vstoupit
z `/sprava` do režimu podpory s právy admina bez vytvoření členství nebo hráče.

Správce má mimo podporu v běžném API jen svou skutečnou roli v družstvu.
Provozní výjimky jsou výslovně omezené na přehled a zakládání klubů a družstev;
opravy členů a rolí probíhají přes podporu a standardní obrazovku družstva.

---

## 14. Stav původních fází

| Fáze | Stav |
|---|---|
| F0 — Ověření hostingu | Dokončeno, aplikace je nasazená. |
| F1 — Základ | Auth, role, kluby, družstva, členové a sezóny fungují. |
| F2 — Prohřešky | Sazebník, dávky, přehledy, statistiky a storna fungují. Export ani schránka oznámení nejsou požadované. |
| F3 — Docházka | Kalendář, série, odpovědi, nominace a opravy docházky fungují. |
| F4 — Peníze | Zůstatky, ruční platby, QR a cesťáky fungují; pololetí člení data, neuzavírá je. |
| F5 — PWA a oznámení | Instalace, Web Push pro zápisy a připomínky akcí, osobní volby a odběr kalendáře fungují. |
| F6 — Bankovní párování | Nerozhodnuto, bez termínu. Databázové podklady zatím zůstávají. |

Další práce vychází ze zpětné vazby při používání. Platební brána, export plateb
ani přehled oznámení v aplikaci nejsou v aktuálním rozsahu.
