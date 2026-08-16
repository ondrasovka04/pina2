# Pína 2.0 — pokyny pro agenty

Webová aplikace pro týmovou kasu za prohřešky (pína), docházku a nominace ve
volejbalových družstvech. Kompletní přepis ročníkového projektu z roku 2023.
Běží v produkci na https://pinaprosek.eu, spravuje reálné peníze reálných lidí.

Přehled projektu je v [README.md](README.md), rozhodnutí a jejich zdůvodnění
v [docs/ANALYZA-TECHNICKA.md](docs/ANALYZA-TECHNICKA.md).

## Jazyk

Česky se píše **všechno, co čte člověk**: texty v UI, komentáře, chybové hlášky,
dokumentace, commit messages. Anglicky zůstávají jen identifikátory v kódu
(`OffenceService`, `membershipId`) a názvy sloupců v databázi.

## Struktura

| Cesta   | Obsah |
|---|---|
| `api/`  | PHP 8.5 backend — vlastní mikro-framework, PDO, JWT. Viz `api/AGENTS.md`. |
| `web/`  | React 19 + TypeScript 7 frontend. Viz `web/AGENTS.md`. |
| `docs/` | Technická a netechnická analýza. |
| `docker/` | Vývojové prostředí (MySQL 8 + PHP 8.5 ve shodě s produkcí). |

`api/` a `web/` jsou oddělené záměrně a nemíchají se zpět dohromady.

## Příkazy

```bash
docker compose up -d                                        # MySQL + PHP na :8080
cd web && npm run dev                                       # frontend na :5173

docker compose run --rm php ./vendor/bin/phpunit            # 252 testů
docker compose run --rm php ./vendor/bin/phpstan analyse --memory-limit=512M
cd web && npm run typecheck && npm run lint && npm test
```

Před dokončením úkolu, který sáhl na kód, musí projít testy i statická analýza
té části, které se změna týká.

## Pravidla, která se neobcházejí

1. **Testy běží jen proti databázi `pina_test`.** Před během si mažou tabulky.
   Pojistka v `api/tests/Integration/DatabaseTestCase.php` shodí test, pokud
   název databáze neobsahuje „test" — jednou už kvůli tomu zmizela vývojová data.
2. **Pošta jde jen na pozvánky a aktivace.** Majitel projektu odesílání povolil
   16. 8. 2026 (do té doby platil úplný zákaz). Posílá se přes SMTP Zoneru
   z `pina@pinaprosek.eu` a vypínač `MAIL_ENABLED` zůstává — ve vývoji je
   **vypnutý**, protože databáze obsahuje reálné adresy reálných lidí a omylem
   rozeslaná dávka se nedá vzít zpět. Jakákoli další kategorie zpráv
   (upomínky, souhrny) potřebuje samostatný souhlas.

   Mimo produkci chrání schránky spoluhráčů **`MAIL_ALLOWLIST`**: prázdný seznam
   tam znamená zákaz, ne povolení. Kdo chce ve vývoji něco odeslat, vypíše svou
   adresu; na všechny ostatní se jen zapíše řádek do logu. Nikdy tuhle pojistku
   neobcházejte — vývojová databáze je kopie ostré a je v ní přes sto adres.
3. **Osobní údaje se necommitují.** Dumpy, `export/`, `*.csv`, `*.sql` a `.env`
   jsou v `.gitignore` a patří tam.
4. **Necommitovat a nepushovat bez pokynu.** Práce se odevzdává jako diff.
5. **Historie peněz se nepřepisuje.** Cena se do zápisu ukládá jako snapshot,
   změna sazebníku nesmí zpětně zdražit loňský trénink. Ruší se přes `voided_at`,
   nikdy `DELETE` — po smazaných penězích zbývá jen dohadování.
6. **Izolace klubů.** Každý přístup k záznamu jde přes `TeamScope`. Cizí záznam
   vrací 404, ne 403, aby neprozradil, že existuje.

   Příznak správce platformy je **provozní role, ne univerzální klíč**. Otevírá
   `/sprava`, kde se zakládají kluby a zachraňují družstva bez admina — ale
   běžné obrazovky se řídí rolí v konkrétním družstvu. Ve družstvu, kde je jeho
   majitel hráč, ho ten příznak pínařem nedělá a cizí dluhy se do provozní
   konzole nevydávají.

## Slovník

Aplikace mluví jazykem týmu, ne jazykem databáze. Když se rozhodujete, jak něco
pojmenovat v UI, držte se levého sloupce.

| V týmu | V kódu | Význam |
|---|---|---|
| pína | — | společná kasa družstva |
| prohřešek | `offence_type` | položka sazebníku (pozdní příchod, zapomenutý dres) |
| pínař | `treasurer` | ten, kdo zapisuje a vybírá |
| dávka | `offence_batch` | zápis za jeden trénink nebo zápas naráz |
| sazebník | seznam `offence_type` | ceník pro danou sezónu |
| dluh / zůstatek | `balance_czk` | kladné číslo = hráč dluží |
| bonus | záporná `amount_czk` | odměna, která dluh snižuje (např. MVP) |
| cesťák | `travel_*` | náhrada za jízdu autem, sazba za km |
| akce | `event` | trénink, zápas nebo cokoli, na co se chodí |
| série | `event_series` | pravidlo opakování, ze kterého se vyrobí termíny |
| nominace | `nomination` | kdo hraje zápas — u tréninku se neřeší |

## Stav

F1 (auth, role, týmy, sezóny, členové), F2 (prohřešky) a F3 (docházka, nominace,
opakované akce) jsou hotové na backendu i frontendu. F4 peníze a cesťáky, F5 PWA,
F6 párování plateb z banky teprve budou. Tabulka fází je v README.

Na pomezí F3 a F4 už stojí **návrh prohřešků z docházky**: po akci se pínaři nabídne
zápis za ty, kdo chyběli, a on ho potvrdí nebo upraví. Který prohřešek to je, říká
`offence_type.auto_rule` spolu s `auto_event_type` — sazba za trénink a za zápas se
u všech družstev liší. Vazba `offence_batch.event_id` je tím pádem konečně plněná;
do té doby byla ve schématu naprázdno.

Nasazení je odložené záměrně až na konec — na hostingu pořád běží verze z roku 2023.
