# Pína 2.0 — Technická analýza

**Autor:** Ondřej Kopáč
**Datum:** 14. 8. 2026
**Předchozí verze:** ročníkový projekt 2023 (Expo/React Native + PHP API + MySQL)

---

## 1. Výchozí stav

### 1.1 Co dnes existuje

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
│  TanStack Query · React Router · Tailwind · shadcn/ui   │
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
│            → Repository (PDO, prepared statements)       │
└───────────────────────┬─────────────────────────────────┘
                        │ PDO / MySQL
┌───────────────────────▼─────────────────────────────────┐
│  MySQL 8 (Zoner) — nové schéma, InnoDB, utf8mb4          │
└──────────────────────────────────────────────────────────┘

Externí služby (volitelné, fáze 2+):
  · SMTP (Zoner) → pozvánky, reset hesla, upomínky
  · Web Push (VAPID) → notifikace na mobil
  · Fio banka REST API → import transakcí, párování plateb
  · Nominatim / Google Maps → geokódování adres, navigace
```

Klíčová změna proti verzi 2023: **server je jediný zdroj pravdy o oprávněních**.
Frontend UI se podle role jen překresluje, ale rozhodnutí "smíš to?" padá v PHP.

---

## 3. Technologie a zdůvodnění

### 3.1 Frontend

| Volba | Proč |
|---|---|
| **React 19 + TypeScript** | Znalost z předchozí verze, typy odstraní celou třídu chyb, které byly v JS verzi |
| **Vite 6** | Build do statických souborů → přesně to, co Czechia hosting umí obsloužit. Rychlý dev server. |
| **React Router 7** (data router) | Standardní routing SPA, podpora chráněných rout |
| **TanStack Query v5** | Cache serverového stavu, refetch, optimistické updaty. Nahradí ruční `fetch` + `useState` z RN verze. |
| **Tailwind CSS v4 + shadcn/ui** | Designový systém, konzistentní komponenty, dark mode zdarma. Hlavní páka pro "aby to bylo hezký". |
| **React Hook Form + Zod** | Validace formulářů; **stejná Zod schémata popisují i tvar API odpovědí** → runtime kontrola dat ze serveru |
| **vite-plugin-pwa** | Instalace na plochu telefonu, offline shell, Web Push. Nahradí zrušenou Android aplikaci. |
| **Recharts** | Grafy (koláče podílu prohřešků, vývoj docházky) — nahradí `react-native-chart-kit` |
| **date-fns + date-fns-tz** | Práce s termíny a opakováním; časová zóna `Europe/Prague` |
| **Vitest + Testing Library + MSW** | Unit a integrační testy komponent proti mockovanému API |
| **Playwright** | E2E smoke testy hlavních scénářů (login → zápis prohřešku → přehled) |

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
| **respect/validation** nebo vlastní validátor | Validace vstupů na hranici API |
| **PHPUnit 11** | Testy service vrstvy (byznys pravidla) a repository vrstvy proti testovací DB |
| **PHP-CS-Fixer + PHPStan (level 8)** | Statická analýza — PHP bez typové kontroly je hlavní zdroj chyb ve staré verzi |
| **phinx** nebo vlastní migrační skripty | Verzované změny schématu; nutné, protože schéma se bude vyvíjet |

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
club ──┬── team ──┬── season ──┬── roster_entry ── membership
       │          │            ├── offence_type
       │          │            ├── event_series ── event ── event_participant
       │          │            └── offence_record
       │          └── membership ── user
       └── club_settings

payment ── bank_transaction        (fáze 2)
invitation / password_reset / refresh_token / audit_log   (infrastruktura)
```

### 4.2 Organizace a lidé

**`club`** — tenant. Jeden klub = jedna izolovaná datová doména.
```sql
id            BIGINT PK AUTO_INCREMENT
name          VARCHAR(120) NOT NULL          -- "SK Prosek Praha"
slug          VARCHAR(60) UNIQUE NOT NULL    -- "sk-prosek" (pro URL)
created_at    DATETIME NOT NULL
status        ENUM('active','suspended') DEFAULT 'active'
```

**`team`** — družstvo v klubu (muži A, ženy, junioři). Klub může mít jen jedno.
```sql
id, club_id FK, name VARCHAR(120), color VARCHAR(7), archived_at DATETIME NULL
```

**`user`** — člověk, globálně napříč kluby (jeden účet, víc týmů).
```sql
id            BIGINT PK
email         VARCHAR(190) UNIQUE NOT NULL
display_name  VARCHAR(120) NOT NULL
password_hash VARCHAR(255) NULL              -- NULL = pozvaný účet, heslo si nastaví sám
phone         VARCHAR(30) NULL
avatar_url    VARCHAR(255) NULL
is_platform_admin BOOLEAN DEFAULT FALSE      -- nahrazuje "id = 1"
email_verified_at, created_at, last_login_at DATETIME NULL
```

**`membership`** — členství uživatele v týmu **a jeho role v tomto týmu**.
Tohle je jádro nového modelu rolí.
```sql
id, user_id FK, team_id FK
role          ENUM('admin','treasurer','player') NOT NULL   -- admin / pínař / hráč
jersey_number SMALLINT NULL
status        ENUM('active','suspended','left') DEFAULT 'active'
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
auto_rule ENUM('none','unexcused_absence','late_arrival') DEFAULT 'none',
archived_at DATETIME NULL
```
`auto_rule` — nový koncept: prohřešek, který systém navrhne sám z docházky
(neomluvená absence → automaticky navržený zápis, který pínař jen potvrdí).

**Kopírování sazebníku:** data ukazují 262 položek, ale jen 171 unikátních kombinací
tým+název — sazebník se každou sezónu zakládá ručně znovu. Při vytvoření sezóny proto
nabídnout **převzetí sazebníku z předchozí sezóny téhož týmu** (nebo z jiného družstva)
s hromadnou úpravou cen. `POST /api/v1/seasons/{s}/offence-types/copy-from/{sourceSeasonId}`.

**`offence_batch`** — jedna zapisovací seance („prohřešky za trénink 16. 9.").
Existuje proto, aby šlo zobrazit souhrn před odesláním, poslat **jedno** oznámení
místo pěti a stornovat celou dávku najednou.
```sql
id BIGINT PK, season_id FK, event_id BIGINT NULL FK,
occurred_on DATE NOT NULL,
title VARCHAR(120) NULL,             -- "Turnaj Kbely" (když není navázáno na akci)
note VARCHAR(255) NULL,
client_uuid CHAR(36) UNIQUE NOT NULL,-- idempotence: dvojklik nezaloží dvě dávky
created_by BIGINT FK user, created_at DATETIME,
voided_at DATETIME NULL, voided_by BIGINT NULL FK
```

**`offence_record`** — konkrétní zápis. **Klíčová oprava:** ukládá se snapshot částky.
```sql
id BIGINT PK
season_id FK, membership_id FK, offence_type_id FK
batch_id      BIGINT NULL FK        -- dávka, ve které vznikl
amount_czk    INT NOT NULL          -- ← snapshot ceny v okamžiku zápisu
occurred_on   DATE NOT NULL         -- ke kterému dni se váže
event_id      BIGINT NULL FK        -- volitelná vazba na trénink/zápas
note          VARCHAR(255) NULL
created_by    BIGINT FK user        -- kdo zapsal (audit)
created_at    DATETIME
voided_at     DATETIME NULL         -- storno místo DELETE
voided_by     BIGINT NULL FK
INDEX (season_id, membership_id), INDEX (season_id, occurred_on)
```
Mazání se nahrazuje **stornem** (`voided_at`) — pro pínaře je důležité vidět,
že zápis existoval a kdo ho zrušil.

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
attendance_locked_at DATETIME NULL,
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
transport   ENUM('none','driver','passenger') DEFAULT 'none',
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

### 4.6 Cestovní náhrady a zúčtování

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
team_id PK, travel_enabled BOOLEAN, travel_rate_czk_km DECIMAL(5,2),
settlement_period ENUM('none','half_year','season'),
attendance_visible_to_players BOOLEAN DEFAULT 0,
balances_visible_to_players   BOOLEAN DEFAULT 1
```

**`travel_claim`** — nárok na náhradu za cestu vlastním autem.
```sql
id, season_id FK, membership_id FK, event_id FK NULL, occurred_on DATE,
distance_km SMALLINT, rate_czk_km DECIMAL(5,2),   -- snapshot sazby
amount_czk INT, passengers TINYINT NULL, settlement_id FK NULL, voided_at
```
`distance_km` se předvyplní z `event.distance_km` (vzdálenost tam a zpět), takže
řidič jen potvrdí. Sazba se ukládá jako snapshot — pozdější zdražení nepřepíše
už vyúčtované období.

**`settlement` + `settlement_line`** — uzávěrka období (typicky pololetí).
Sečte prohřešky, bonusy, cesťáky a platby a vyčíslí, kdo komu kolik dluží:
```sql
settlement:      id, season_id, name, period_from, period_to, closed_at
settlement_line: settlement_id, membership_id,
                 offences_czk, bonuses_czk, travel_czk, paid_czk,
                 balance_czk    -- >0 hráč dluží, <0 tým dluží hráči
```
Řádky jsou **snapshot** — po uzavření období se zpětnou změnou sazebníku ani
doplněným zápisem nezmění. Tím se z píny stává obousměrná pokladna: dosud uměla
jen vybírat, nově i proplácet.

### 4.7 Platby

**`payment`** — úhrada píny.
```sql
id, season_id FK, membership_id FK,
amount_czk INT NOT NULL, paid_on DATE NOT NULL,
method ENUM('cash','transfer','qr','gateway') NOT NULL,
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
refresh_token   (id, user_id, token_hash, expires_at, revoked_at, user_agent, ip)
invitation      (id, team_id, email, role, token_hash, expires_at, accepted_at, invited_by)
password_reset  (id, user_id, token_hash, expires_at, used_at)
login_attempt   (id, email, ip, succeeded, created_at)          -- rate limiting
audit_log       (id, club_id, actor_user_id, action, entity, entity_id, payload JSON, created_at)
push_subscription (id, user_id, endpoint, p256dh, auth, created_at)
notification_pref (user_id, channel, event_type, enabled)
notification      (id, user_id, type, title, body, link, payload JSON, read_at, created_at)
notification_queue(id, notification_id, channel, status, attempts, last_error, send_after)
```

`notification` je in-app schránka (vidí ji každý bez ohledu na push a e-mail),
`notification_queue` je odesílací fronta s opakováním — selhání push serveru
nesmí shodit zápis prohřešků.

`audit_log` je nový — u peněz a docházky je "kdo to změnil a kdy" požadavek, ne luxus.

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
| Odpovědět na nominaci (RSVP) | ✓ | ✓ | ✓ | — |
| Vidět procenta účasti spoluhráčů | ✓* | ✓ | ✓ | ✓ |
| **Zapsat / stornovat prohřešek** | — | ✓ | ✓ | — |
| **Označit platbu jako přijatou** | — | ✓ | ✓ | — |
| Zapsat docházku u akce | — | ✓ | ✓ | — |
| Vytvořit / upravit akci, sérii, místo | — | — | ✓ | — |
| Sestavit nominaci | — | — | ✓ | — |
| Spravovat sazebník prohřešků | — | — | ✓ | — |
| Spravovat sezóny (založit, uzavřít) | — | — | ✓ | — |
| Pozvat hráče, měnit role, pozastavit | — | — | ✓ | — |
| Nastavení klubu, bankovní účet | — | — | ✓ | — |
| Zakládat a mazat kluby | — | — | — | ✓ |

\* konfigurovatelné v nastavení klubu — někde je veřejná tabulka účasti motivace,
jinde citlivá věc.

Hierarchie: `admin ⊃ treasurer ⊃ player`. Admin tedy nepotřebuje druhou roli, aby si
mohl zapsat vlastní prohřešek.

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

```apache
# /api/.htaccess
RewriteEngine On
RewriteCond %{REQUEST_FILENAME} !-f
RewriteRule ^ index.php [QSA,L]
```

```
POST   /api/v1/auth/login | refresh | logout
POST   /api/v1/auth/password/forgot | reset
POST   /api/v1/invitations/{token}/accept
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

GET    /api/v1/notifications                   -- in-app seznam
POST   /api/v1/notifications/{id}/read
GET    /api/v1/me/notification-preferences
PUT    /api/v1/me/notification-preferences

GET    /api/v1/seasons/{s}/events?from=&to=    -- kalendář
POST   /api/v1/seasons/{s}/events
POST   /api/v1/seasons/{s}/event-series
PATCH  /api/v1/events/{id}
PUT    /api/v1/events/{id}/nominations         -- hromadná nominace
PUT    /api/v1/events/{id}/rsvp                -- odpověď hráče (jen za sebe)
PUT    /api/v1/events/{id}/attendance          -- zápis docházky
GET    /api/v1/seasons/{s}/attendance/summary  -- procenta účasti

GET    /api/v1/seasons/{s}/balances            -- kdo kolik dluží
POST   /api/v1/seasons/{s}/payments
GET    /api/v1/memberships/{id}/payment-qr     -- SPAYD řetězec pro QR
GET    /api/v1/clubs/{c}/bank-transactions     -- fáze 2
POST   /api/v1/bank-transactions/{id}/match

POST   /api/v1/push/subscribe
GET    /api/v1/seasons/{s}/export?format=csv|xlsx
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

**Sdílené typy:** PHP typy → OpenAPI 3.1 spec → generované TS typy pro frontend
(`openapi-typescript`). Jeden zdroj pravdy o tvaru API napříč dvěma jazyky —
tohle je hlavní protiopatření proti nevýhodě "dva jazyky" u zvoleného stacku.

---

## 7. Klíčová doménová logika

### 7.1 Generování opakovaných akcí
Série drží `RRULE`. Všechny termíny se materializují **najednou při vytvoření série**,
až do `season.ends_on` (řádově desítky řádků — viz 4.5). Nepotřebuje to plánovanou úlohu.

Při změně série:
- **minulé termíny se nikdy nepřepisují** (nesou docházku, tedy historii),
- budoucí se přegenerují,
- výjimkou jsou instance s příznakem `overridden` (ručně upravený čas/místo) nebo
  s už existujícími odpověďmi hráčů — ty zůstanou beze změny a admin dostane
  upozornění, kterých termínů se změna nedotkla.

Cron je potřeba jinde — push připomínky před akcí (hodinově), import z banky a záloha
DB (denně), upomínky dluhů (měsíčně). Na Zoneru přes cron v administraci hostingu,
při jeho absenci přes GitHub Actions `schedule`, které zavolá chráněný endpoint API.

### 7.2 Automatické prohřešky z docházky
Když pínař uzavře docházku akce, service projde `event_participant` a pro každého
s `attendance = 'unexcused'` a existujícím `offence_type.auto_rule = 'unexcused_absence'`
**navrhne** zápis. Návrh se pínaři zobrazí k potvrzení — nikdy se nezapisuje
automaticky bez člověka. (Peníze + automat bez kontroly = konflikt v týmu.)

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

> **Pína — trénink 16. 9.**
> Byly ti zapsány 3 prohřešky za 60 Kč. Celkem dlužíš 340 Kč.

Klepnutí otevře detail dávky s rozpisem. Kanály:
- **Web Push** pro ty, kdo mají PWA na ploše a notifikace povolené,
- **e-mail** jako fallback,
- **in-app** seznam oznámení vždy (i pro toho, kdo obojí odmítl).

Každý uživatel si v nastavení volí, co chce dostávat (`notification_pref`).
Odesílání běží **po commitu transakce** a jeho selhání nesmí shodit zápis —
neúspěšné notifikace jdou do fronty (`notification_queue`) a zkusí se znovu.
Storno dávky pošle opravné oznámení („zápis byl zrušen").

Stejný mechanismus se použije pro ostatní události: nová nominace, připomínka akce,
upomínka dluhu, potvrzení přijaté platby.

### 7.4 QR platba (fáze 1, nulové náklady)
Backend složí SPAYD řetězec (standard ČBA, čitelný všemi českými bankami):
```
SPD*1.0*ACC:CZ6508000000192000145399*AM:250.00*CC:CZK*X-VS:10420037*MSG:Pina podzim 2026
```
Frontend ho vykreslí do QR (knihovna `qr-code-styling`). Hráč naskenuje v bankovní
aplikaci, částka i VS jsou předvyplněné. Pínař pak platbu odklikne.
**Náklady: 0 Kč. Bez smlouvy, bez KYC, bez API.**

### 7.5 Automatické párování plateb (follow-up, mimo hlavní rozsah)

> **Rozsah:** tohle je **samostatný modul odložený na F6** a nic dřívějšího na něm nestojí.
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
| `UzivatelTym` | `membership` (role `player`) | `pozastaven=1` → `status='suspended'` |
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
    events/     kalendář, detail akce, série, místa
    attendance/ nominace, RSVP, zápis docházky, statistiky
    payments/   dluhy, QR, potvrzení, párování
    team/       členové, role, sezóny, nastavení klubu
  components/ui shadcn komponenty
  lib/          api klient (fetch wrapper + refresh), auth kontext, formátování
  types/        generováno z OpenAPI
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
- `vite-plugin-pwa`, manifest, ikony, offline shell (kalendář a přehled se čtou z cache).
- Instalace na plochu: Android i iOS (16.4+) — nahrazuje ztracenou Play Store distribuci.
- Web Push (VAPID) z PHP přes `minishlink/web-push`:
  - **zapsané prohřešky — jedno agregované oznámení za dávku** (viz 7.3),
  - nová nominace,
  - připomínka akce 24 h a 2 h předem,
  - potvrzení přijaté platby,
  - měsíční upomínka dluhu.
  Na iOS funguje push jen pro PWA přidanou na plochu — v UI je potřeba onboarding krok
  "přidat na plochu".
- E-mail (PHPMailer) jako fallback pro ty, kdo push nepovolí.

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
   → **`mysqldump` z PHP volat nelze.** Zálohu musí dělat vlastní PHP dumper
   (iterace tabulek přes PDO, streamovaný zápis do souboru), případně zálohovací
   službu Zoneru. Ruší to původní plán „serverový skript zavolá mysqldump".
2. **`max_execution_time = 30 s`, `max_input_time = 30 s`, `memory_limit = 128 M`.**
   → migrace 6 116 řádků, generování událostí ze série i záloha musí být **dávkované**
   a odolné vůči přerušení (kurzor / offset, idempotentní kroky). Žádná operace
   nesmí spoléhat na jeden dlouhý běh.
3. **`open_basedir = /www/sites/8/site92718`**, přičemž web root je
   `/www/sites/8/site92718/public_html`.
   → **složka nad web rootem je pro PHP přístupná** — `.env`, `vendor/` i `storage/`
   mohou být fyzicky mimo web, ne jen chráněné `.htaccess` pravidlem. (Ověřit, zda
   tam dosáhne i FTP účet.)
4. **`log_errors = Off`, `error_log` nenastaven** → chyby se nikam nezapisují.
   Aplikace si musí logovat sama (vlastní handler / Monolog do `storage/logs`).
5. **`phar.readonly = On`** → composer se pouští lokálně, `vendor/` se nahrává přes FTP
   (tak to bylo plánováno).
6. **Výchozí session cookie nastavení je nezabezpečené** (`cookie_httponly=Off`,
   `cookie_secure=Off`, `use_strict_mode=Off`) → parametry cookie nastavovat explicitně
   v aplikaci, nespoléhat na php.ini.
7. **Odchozí pošta** jde přes `/usr/bin/cwebsmail` (`sendmail_from webmaster@pinaprosek.eu`),
   SMTP `localhost:25`. Pro doručitelnost pozvánek ověřit SPF/DKIM domény; při problémech
   sáhnout po externím SMTP.
8. `max_input_vars = 1000` — netýká se nás, dávkový zápis jde jako JSON body, ne form fields.

### 10.2 Prostředí
- lokální vývoj: Docker (PHP 8.3 + Apache + MySQL 8) nebo XAMPP, `vite dev` s proxy na `/api`,
- produkce: Czechia hosting, doména `pinaprosek.eu`, SSL od Zoneru.

**Struktura na serveru** — díky `open_basedir` sahajícímu nad web root (viz 10.1)
jde citlivý obsah umístit mimo dosah webu:
```
/www/sites/8/site92718/
  app/                         ← z webu NEDOSTUPNÉ
    src/                       ← PHP zdrojáky
    vendor/                    ← composer, nahráno z CI
    .env                       ← DB credentials, JWT secret, SMTP
    storage/logs/              ← aplikační log (log_errors je na serveru vypnutý)
    storage/backups/           ← dumpy z PHP dumperu
  public_html/                 ← web root
    index.html, assets/        ← build SPA
    .htaccess                  ← SPA fallback (vše na index.html kromě /api)
    api/index.php + .htaccess  ← front controller, jediný PHP soubor ve webu
  tmp/
```
**Konfigurace přes `.env`**, načítanou `vlucas/phpdotenv` — konec s credentials
v 45 souborech. Kdyby FTP účet nad `public_html` nedosáhl, fallback je `.htaccess`
pravidlo `<Files ".env"> Require all denied </Files>`.

**Nový databázový uživatel:** stávající účet `pinaprosek` má heslo zapsané v 45 starých
PHP souborech a prošlo řadou míst. Nová aplikace dostane vlastního DB uživatele
s novým heslem; starý účet se po vypnutí staré verze zruší.

**CI/CD:** GitHub repo → GitHub Actions:
1. `npm ci && npm run build` (frontend),
2. `composer install --no-dev` (backend),
3. testy + PHPStan + typecheck,
4. deploy přes `SamKirkland/FTP-Deploy-Action` (jen změněné soubory).

Staging: podsložka `beta.pinaprosek.eu` nebo `/test` s vlastní DB.

**Migrace schématu v produkci:** chráněný CLI endpoint `/api/migrate.php` s tokenem
(Zoner nemá SSH), nebo ruční spuštění SQL v phpMyAdmin podle verzovaných skriptů.

**Zálohy:** vzdálené připojení k MySQL není možné (port 3306 filtrovaný) a `mysqldump`
z PHP volat nelze (`disable_functions`). Zálohu proto dělá **vlastní PHP dumper** —
iterace tabulek přes PDO s kurzorem, streamovaný zápis do `app/storage/backups/`,
dávkovaně kvůli limitu 30 s. Spouští ho cron Zoneru nebo chráněný endpoint volaný
z GitHub Actions, které si dump zároveň stáhnou a odloží jako artefakt mimo hosting.
Retence 30 dní. Stará aplikace zálohy neměla — u dat o penězích je to nutnost.

**Monitoring:** logování chyb do souboru + volitelně Sentry (free tier),
uptime check zdarma (UptimeRobot).

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
| Bez záloh | denní automatický dump |

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
| E2E | Playwright | login → nominace → RSVP → docházka → prohřešek → dluh → QR |
| Migrace | vlastní kontrolní skript | shoda počtů a součtů se starou DB |

Prioritně testovat: **peníze a autorizaci**. Chyba v procentu účasti je nepříjemná,
chyba v dluhu nebo v izolaci klubů je konec důvěry v aplikaci.

---

## 13. Rizika a otevřené otázky

**Rizika**
1. *Limity sdíleného hostingu* — **z velké části vyřešeno** (viz 10.1): PHP 8.2 → 8.4/8.5,
   `sodium`, `intl`, `gmp`, `curl` i `redis` k dispozici. Zbývá ověřit: dostupnost cronu
   na tarifu, počet databází, zda běží redis/memcached server (ne jen rozšíření),
   a zda FTP účet dosáhne nad `public_html`.
2. *Bez SSH a bez vzdáleného MySQL* — **ověřeno:** port 3306 je zvenčí filtrovaný.
   Deploy jde jen přes FTP, migrace schématu a zálohy musí běžet jako PHP skript
   na serveru. Řešitelné, ale nutné s tím počítat od začátku (nelze si lokálně
   pustit migraci proti produkci).
3. *Dva jazyky* — riziko rozjetí typů mezi PHP a TS. → OpenAPI jako jediný zdroj pravdy.
4. *Rozsah* — docházka + nominace + platby + multi-tenant je hodně na jednu iteraci.
   → fázovat (kapitola 14), MVP nasadit dřív, než bude hotové všechno.
5. *Fio API vyžaduje účet u Fio banky* — netýká se hlavního rozsahu (F6 je follow-up).
   Pokud má klub jinou banku, použije se import výpisu (CSV/ABO), který umí každá banka.

**Otázky k rozhodnutí**
- Jaký PHP tarif/verze na Zoneru přesně běží a kolik databází umožňuje?
- Má tým bankovní účet, ke kterému bude přístup pro čtení? (Netřeba řešit teď — až u F6.
  Číslo účtu pro QR platbu ale potřeba je, už u F4.)
- Má "klub" mít víc družstev (muži A/B, ženy), nebo stačí model 1 klub = 1 tým?
- Mají hráči vidět dluhy ostatních, nebo jen souhrn týmu?
- Kdo smí zapisovat docházku — jen pínař, nebo i kapitán/trenér (další role)?
- Zůstane `pinaprosek.eu` jako doména i pro víc klubů, nebo bude potřeba neutrální název?

---

## 14. Fázový plán

| Fáze | Obsah | Výstup |
|---|---|---|
| **F0 — Ověření** ✓ | phpinfo ✓, archivační dump staré DB ✓, přepnutí na PHP 8.5.9 ✓, ověření běhu staré aplikace ✓ — zbývá: založení repa, CI skeleton, ověření cronu a dosahu FTP účtu | jistota, že stack na hostingu poběží |
| **F1 — Základ** | nové schéma, migrace dat, auth (login/pozvánka/reset), role, izolace klubů, layout + design systém | přihlášení a správa týmu v produkci |
| **F2 — Prohřešky** | sazebník, dávkový zápis se souhrnnou obrazovkou, přehledy, storno dávky i zápisu, statistiky, export, **in-app a e-mailové oznámení o zápisu** | funkční náhrada staré aplikace → **vypnutí staré verze** |
| **F3 — Docházka** | místa + navigace, jednorázové akce, opakované série, RSVP, nominace na zápasy, oprava docházky, procenta účasti (jen admin) | hlavní nová funkce |
| **F4 — Peníze** | dluhy, bonusy, ruční platby, QR (SPAYD), upomínky | uzavření finančního cyklu |
| **F4b — Cesťáky a zúčtování** | „jedu autem" + volná místa, sazba za km, nároky na náhradu, půlroční uzávěrka | nahradí dnešní obcházení přes záporné položky sazebníku |
| **F5 — PWA a push** | instalace na plochu, Web Push nad frontou z F2, připomínky akcí, nastavení preferencí | náhrada zrušené mobilní aplikace |
| **F6 — Bankovní párování** *(follow-up)* | Fio API import, algoritmus párování, rekonciliace, fronta nespárovaných | téma pro diplomovou práci; **mimo hlavní rozsah**, nic na něm nestojí |
| **F7 — Volitelné** | platební brána jako modul, veřejná registrace klubů, statistiky napříč sezónami | podle zájmu |

**Hlavní rozsah končí F5.** Po něm je aplikace plnohodnotnou náhradou staré verze
plus docházka, nominace a platby. F6 a F7 jsou nezávislé přírůstky, které se dají
udělat kdykoli později (nebo vůbec).

Doporučení: **F2 nasadit do produkce co nejdřív** a starou aplikaci vypnout —
udržovat dvě verze zároveň je zbytečná zátěž a bezpečnostní riziko.
