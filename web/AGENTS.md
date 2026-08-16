# web/ — pokyny pro agenty

React 19 + TypeScript 7 + Vite 8 + Tailwind 4 + TanStack Query + react-router 8.
Cíl je PWA: aplikace se ovládá v hale, na telefonu, jednou rukou a často
s mizerným signálem.

Obecná pravidla projektu jsou v [../AGENTS.md](../AGENTS.md).

## Struktura

```
src/
  app/          složení aplikace — App (routy), AppLayout (rám), session, team
  components/   sdílené kusy UI; components/ui/ je návrhový systém
  features/     obrazovky po doménách (auth, balances, offences, profile)
  lib/          api klient, dotazy, typy, drobné pomůcky
```

Obrazovka patří do `features/<doména>/`. Do `components/ui/` jde jen to, co
používají aspoň dvě různé domény.

## Vzhled

Aplikace umí **světlý i tmavý režim**. Výchozí je systémová volba, ruční
přepnutí je v profilu (`src/lib/theme.ts`, `src/app/theme.tsx`). Motiv nastavuje
krátký skript v `index.html` ještě před vykreslením — bez něj by při každém
načtení bliklo světlé pozadí. **Žádné `dark:` varianty v komponentách:** barvy
se řeší hodnotami tokenů, ne dvojicí tříd u každého prvku.

Barvy **výhradně přes tokeny** z `src/styles.css`, nikdy `text-slate-400`
a podobně. Tokeny jsou ve dvou vrstvách:

| Token                           | Vrstva     | Na co                                                       |
| ------------------------------- | ---------- | ----------------------------------------------------------- |
| `surface-0…3`                   | sémantická | plochy odspodu nahoru (stránka → karta → pole → zvýraznění) |
| `ink`, `ink-muted`, `ink-faint` | sémantická | text ve třech úrovních, víc jich není                       |
| `line`                          | sémantická | oddělovače a rámečky                                        |
| `accent`, `on-accent`           | sémantická | zlatý akcent a text na něm                                  |
| `debt`, `bonus`                 | sémantická | peníze **v textu**                                          |
| `brand-*`                       | paleta     | klubová modř — identita a hlavní akce                       |
| `gold-*`                        | paleta     | zlatá ze znaku, hlavně pro `ClubMark`                       |
| `debt-500`, `bonus-500`         | paleta     | peníze jako **výplň** (tlačítko, podbarvení)                |

Sémantická vrstva se mění mezi motivy, paleta ne. Když píšete text, sáhněte po
`text-debt`; když plochu, po `bg-debt-500`. Nové barvy patří do `styles.css`
jako token, ne do komponenty jako `oklch(...)`.

Pravidla, která drží aplikaci pohromadě:

- **Nic klikacího pod 2,75 rem** (hlídá `styles.css`). Ovládá se to palcem vestoje.
- **Částky přes `<Money>`**, ne ručně formátovaný text. Komponenta řeší barvu
  i tabulkové číslice, aby řády ve sloupci neposkakovaly.
- **Barva nikdy nenese informaci sama.** Bonus se pozná i ze slova, nejen ze zelené.
- **Zlatá je akcent, ne výplň.** Když svítí všechno, nesvítí nic.
- Stavy načítání, chyby a prázdna přes `LoadingState` / `ErrorState` / `EmptyState`.
- **Žádné `window.confirm`, `alert` ani `prompt`.** Vypadají jako cizí těleso
  a nedají se nastylovat. Na potvrzení je `ConfirmDialog` (nativní `<dialog>`,
  takže past na fokus i Escape fungují samy).
- Nové barevné kombinace ověřte **v obou motivech**. Nejčastější past je zlatá
  nebo světle zelená jako text — na bílé zmizí.

## Data

Server je jediný zdroj pravdy, klientský stav drží jen rozepsané formuláře.

- Dotazy a mutace přes hooky v `src/lib/queries.ts`, klíče přes `queryKeys` —
  invalidace pak trefí přesně to, co se změnilo. Nové endpointy přidávejte tam,
  ne přímým voláním `api` z komponenty.
- `src/lib/api.ts` drží access token **v paměti** (ne v localStorage — při XSS
  by se dal přečíst). Refresh token je v HttpOnly cookie a obnovení při 401
  proběhne samo, včetně zopakování požadavku.
- Chyby z API jsou `ApiError` s českou hláškou a `field` u provinilého pole.
  Zobrazujte hlášku ze serveru, ne vlastní „něco se pokazilo".
- Typy odpovědí jsou v `src/lib/types.ts` a udržují se podle `@phpstan-type`
  anotací v `api/src/Service/`. Když měníte payload na backendu, opravte i tady.

## Styl kódu

- oxfmt: **tabulátory, jednoduché uvozovky, bez středníků, šířka 120**.
  Formátování ani řazení importů neřešte ručně, pusťte `npm run format`.
- Importy přes alias `@/…`. Alias je současně v `tsconfig.json` i `vite.config.ts`
  a musí zůstat v obou.
- TypeScript jede přísně (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax`). Typové importy pište `import type`. `any` a `as` jsou
  přiznání, že něco nesedí — hledejte příčinu.
- Komentáře česky a jen tam, kde vysvětlují **proč**.
- Bez nových závislostí. Ikony jsou vlastní v `components/ui/icons.tsx`.
- Typy událostí: `FormEvent` je v typech Reactu 19 označený za zastaralý
  („doesn't actually exist"). Pro odeslání formuláře patří `SubmitEvent<HTMLFormElement>`,
  pro změnu pole `ChangeEvent`.

## Testy

Vitest. Doménová logika se drží mimo komponenty právě proto, aby šla testovat
bez vykreslování — vzor je `features/offences/draft.ts` a jeho test. Cokoli, co
počítá peníze, dostane test.

```bash
npm run typecheck && npm run lint && npm test && npm run format
```

## Na co si dát pozor

- **Dávkový zápis je idempotentní** přes `clientUuid`. Ten se generuje jednou na
  rozepsanou dávku a **nemění se mezi pokusy o odeslání** — jinak by výpadek sítě
  zapsal peníze dvakrát. Nový vzniká až po úspěchu.
- **Souhrn před odesláním posílá i cenu**, kterou uživatel viděl
  (`expectedAmountCzk`). Když se mezitím změnil sazebník, server vrátí 409
  `PRICE_CHANGED` a souhrn se přepočítá — není to chyba, je to pojistka.
- **Role se liší podle týmu.** Tentýž člověk bývá u mužů hráč a u juniorů pínař;
  co smí, se ptejte přes `can()` z `useTeam()`, ne z globálního uživatele.
- **Sezóna je druhá osa vedle týmu.** `useTeam()` dává `season`, `seasonId`
  i `isSeasonClosed`. Do uzavřené sezóny se nedá zapisovat — obrazovka to musí
  říct dopředu, ne nechat uživatele naklikat práci a spadnout na 409.
- **Zapisuje se po lidech, ne po prohřešcích.** Pínař obchází kabinu a u každého
  se ptá, co provedl. Kdo to přehodí, dělá to proti tomu, jak se aplikace používá.
- **Routy jedou na datovém routeru** (`createBrowserRouter`), a to kvůli
  `useBlocker` — rozepsaná dávka se nesmí ztratit odchodem ze stránky.
  Přechod zpět na `<BrowserRouter>` by tuhle ochranu tiše vypnul.
- **Záporné částky jsou běžné.** Nikde nepředpokládejte kladné číslo.
- **Odkaz na jedno použití se ukáže jen jednou.** Pozvánka i aktivační odkaz
  nesou token, který server drží jen jako otisk — po zavření dialogu se
  nedohledá. `OneTimeLinkDialog` to musí říct nahlas a nabídnout zkopírování.
  Odkazy se **neposílají e-mailem**, předávají se v týmovém chatu.
- **Členství se nemaže, jen mění stav.** Odešlý člen zůstává kvůli historii,
  takže seznam členů roste; ve výpisech patří dolů (`sortMembers`).
- **Seznamy chodí zabalené** (`{ teams: [...] }`, `{ items: [...] }`, `{ seasons: [...] }`),
  detaily ne. Než napíšete typ odpovědi, podívejte se do příslušného controlleru
  v `api/src/Controller/` — TypeScript tenhle rozdíl sám nezachytí a projeví se
  až za běhu.
- **Role potřebná pro akci se liší podle endpointu.** Peníze (zápisy, sazebník,
  zúčtování) spravuje pínař, lidi a sezóny admin. Berte roli z `Service` třídy
  na backendu, ne odhadem — jinak uživateli ukážete formulář, který skončí 403.
