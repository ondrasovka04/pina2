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
- **Návrh z docházky je jen předvyplněný koncept.** Když má zápis vybranou akci,
  `suggestFromAttendance` naplní draft těm, kdo chyběli — a od té chvíle je to
  obyčejný rozepsaný zápis, který jde libovolně upravit. Vloží se **jen jednou
  a jen do prázdného draftu**; nikdy nepřepisuje, co pínař naklikal. Omluvenou
  absenci pozná podle `rsvp === 'no'`, zraněné a lidi mimo soupisku vynechává.
  Když chybí odpovídající položka sazebníku (`autoRule`), radši nenavrhne nic,
  než aby strhla cizí částku.
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
- **Docházka se neodklikává, jen opravuje.** Hráč předem řekne „přijdu" a po
  začátku akce je z toho docházka; pínař přepisuje výjimky. Obrazovka to musí
  říkat nahlas, jinak bude pínař hledat tlačítko „zapsat docházku", které
  schválně neexistuje. **Odpovídat jde jen do začátku akce** (`event.started`) —
  server to odmítne s 409 `EVENT_STARTED`.
- **Sourozenci nesmí sdílet `key`.** V detailu akce stály vedle sebe tři karty
  s `key={event.id}` a React je při překreslení zdvojoval — projevilo se to jen
  u zápasu, kde se vedle odpovědi vykreslí i nominace. Když komponentu resetujete
  klíčem, dejte mu předponu (`odpoved-`, `nominace-`). Hlídá to `EventPage.test.tsx`.
- **Doma se necestuje.** `TeamEvent.isHome` odvozuje server z domácí haly
  družstva (`team_settings.home_location_id`); `null` znamená „nedá se říct" —
  u tréninku nebo když hala nastavená není. U domácího zápasu se neřeší odvozy
  ani vzdálenost, stejně jako u tréninku, a server obojí zahodí. Podmínka v UI
  je `event.isHome !== true`, ne `=== false`: dokud hala není nastavená, není
  důvod otázku na odvoz schovávat.
- **Zůstatek má čtyři složky.** `MemberBalance` nese `offencesCzk`, `bonusesCzk`,
  `paidCzk` a `travelCzk`; `balanceCzk` je jejich výsledek, ne samostatný údaj.
  Nikdy je nepřepočítávejte v klientu — server je jediný zdroj pravdy o penězích.
  `BalanceList.visibility` říká `'own'`, když hráč vidí jen sebe: pak nemá smysl
  řazení ani pořadí „x. z y".
- **Pololetí se vybírá, nepočítá.** Server posílá `periods` (vždy `all`, k tomu
  `first`/`second`, když má sezóna přelom) a hotové součty v `halves`. Klient si
  jen vybere přes `features/balances/period.ts` — logika je mimo komponenty právě
  proto, aby šla testovat. Ploché hodnoty jsou celá sezóna, `halves === null`
  znamená, že se pololetí neřeší a přepínač se nevykresluje.

  Seznamy plateb a cesťáků se filtrují podle data v klientu (`itemsInPeriod`),
  protože jsou to datované položky, ne přepočítávání peněz. Když období nesedí,
  `itemsInPeriod` **nefiltruje nic** — schovat peníze je horší než ukázat víc.

- **Nula se nikdy nevypisuje se znaménkem.** Obrazovky obracejí znaménko
  u zaplaceno a cesťáků a `-0` je v JS pravda `=== 0`, takže `Intl` vypsalo
  „-0 Kč". Řeší to `formatCzk`; kdo formátuje peníze jinak, tu past objeví znovu.
- **Cesťák se zadává jedním směrem, ukládá tam i zpět.** Formulář se ptá na
  vzdálenost jedním směrem, `TravelClaim.distanceKm` už je proplácená vzdálenost
  po zdvojení. Nezdvojujte ji znovu při zobrazení.
- **Peníze mají tři obrazovky, ne jednu.** `/dluhy` je kdo kolik dluží, `/zapisy`
  historie dávek prohřešků, `/platby` přijaté platby a cesťáky. Spodní navigace je
  plná (pět položek), takže nové obrazovky se prolinkovávají z `/dluhy` — ne že
  se do nabídky vecpe šestá.
- **Zapomenutého řidiče doplní pínař v docházce.** Tlačítko „Jel autem?" je
  v `AttendanceSection`, ale jen u venkovního zápasu (`rides`) a jen u toho, kdo
  nebyl označený za nepřítomného. Posílá se `transport` **bez** změny docházky:
  `attendance` se dá jen tam, kde už ruční oprava byla (`corrected`), jinak `null`
  — jinak by kliknutí na řidiče zabetonovalo odvozenou přítomnost jako opravu.
- **Platební QR je doplněk, ne obsah stránky.** Kdo nedluží, kartu nevidí vůbec,
  a při načítání se nevykresluje `LoadingState` — velký spinner, který zmizí, je
  na obrazovce dluhů jen poskakující prázdné místo. Knihovna `qrcode` se dotahuje
  zvlášť; když nedojde, zůstane vidět číslo účtu a VS, protože podle nich se dá
  zaplatit ručně.
- **Kdo přijde, vidí každý; jak akce dopadla, ne.** `EventDetail.canSeeAttendance`
  říká, jestli se smí ukázat docházka ostatních. Nespoléhejte se na roli v klientu —
  server posílá cizí `attendance` jako `null` a UI to musí ustát.
- **Členství se nemaže, jen mění stav.** Odešlý člen zůstává kvůli historii,
  takže seznam členů roste; ve výpisech patří dolů (`sortMembers`).
- **Seznamy chodí zabalené** (`{ teams: [...] }`, `{ items: [...] }`, `{ seasons: [...] }`),
  detaily ne. Než napíšete typ odpovědi, podívejte se do příslušného controlleru
  v `api/src/Controller/` — TypeScript tenhle rozdíl sám nezachytí a projeví se
  až za běhu.
- **Role potřebná pro akci se liší podle endpointu.** Peníze (zápisy, sazebník,
  zúčtování) spravuje pínař, lidi a sezóny admin. Berte roli z `Service` třídy
  na backendu, ne odhadem — jinak uživateli ukážete formulář, který skončí 403.
