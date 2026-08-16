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

docker compose run --rm php ./vendor/bin/phpunit            # 113 testů
docker compose run --rm php ./vendor/bin/phpstan analyse --memory-limit=512M
cd web && npm run typecheck && npm run lint && npm test
```

Před dokončením úkolu, který sáhl na kód, musí projít testy i statická analýza
té části, které se změna týká.

## Pravidla, která se neobcházejí

1. **Testy běží jen proti databázi `pina_test`.** Před během si mažou tabulky.
   Pojistka v `api/tests/Integration/DatabaseTestCase.php` shodí test, pokud
   název databáze neobsahuje „test" — jednou už kvůli tomu zmizela vývojová data.
2. **Žádné odesílání e-mailů.** `MAIL_ENABLED=false` zůstává, dokud majitel
   projektu výslovně neřekne jinak. Účty se smí zakládat, pozvánky se
   nerozesílají.
3. **Osobní údaje se necommitují.** Dumpy, `export/`, `*.csv`, `*.sql` a `.env`
   jsou v `.gitignore` a patří tam.
4. **Necommitovat a nepushovat bez pokynu.** Práce se odevzdává jako diff.
5. **Historie peněz se nepřepisuje.** Cena se do zápisu ukládá jako snapshot,
   změna sazebníku nesmí zpětně zdražit loňský trénink. Ruší se přes `voided_at`,
   nikdy `DELETE` — po smazaných penězích zbývá jen dohadování.
6. **Izolace klubů.** Každý přístup k záznamu jde přes `TeamScope`. Cizí záznam
   vrací 404, ne 403, aby neprozradil, že existuje.

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

## Stav

F1 (auth, role, týmy, sezóny) a F2 (prohřešky) mají hotový backend. Frontend se
staví teď. F3 docházka, F4 peníze a cesťáky, F5 PWA, F6 párování plateb z banky
teprve budou. Tabulka fází je v README.
