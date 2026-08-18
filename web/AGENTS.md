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
- **Vstupní bod musí pouštět stejnou roli jako stránka.** Když se rozšíří
  oprávnění, nestačí povolit obrazovku a API — musí se najít i tlačítko a odkaz,
  kterým se tam jde (`TeamSwitcher`, `CalendarPage`). Pínař jednou dostal právo
  zakládat akce a stejně ho neměl jak použít: `/akce/nova` fungovala, ale „Nová
  akce" v kalendáři pořád visela na `can('admin')`.
- **Selecty jdou přes `components/ui/Select.tsx`, ne přes vlastní třídy.** Safari
  u `<select>` s nativním vzhledem ignoruje `min-height` **i svislý padding** —
  v Chrome pole vypadalo správně, na Safari bylo o třetinu nižší. Zabírá jen
  `appearance-none`, a s ním musí přijít i vlastní šipka. Přepsat styl zvenčí
  nejde spolehlivě: `cn()` třídy jen spojuje, neslučuje je jako tailwind-merge,
  takže by o výsledku rozhodovalo pořadí pravidel ve stylopisu.

  **Poloha vyskakovacího menu se ovlivnit nedá** a je to tak schválně. macOS ho
  otevírá přes pole tak, aby vybraná položka byla pod kurzorem — to je systémová
  konvence, ne chyba. Vlastní dropdown by ji sice srovnal, ale v telefonu by
  zabil systémový vyběrač, který se palcem obsluhuje lépe. Select zůstává nativní.

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
- **Role potřebná pro akci se liší podle endpointu.** Pínař má peníze **a provoz**:
  zápisy, sazebník, akce, série, místa, soupisku sezóny a souhrn účasti. Admin má
  lidi a role, zakládání a uzavírání sezón, přelom pololetí, nastavení družstva
  a nominace. Berte roli z `Service` třídy na backendu, ne odhadem — jinak
  uživateli ukážete formulář, který skončí 403.
- **Přihlášení musí zahodit cache dotazů.** Klíče nenesou uživatele
  (`['seasons', 10, 'balances']`), takže po přepnutí účtu by `staleTime` 30 s
  obsloužil daty předchozího — hráč by uvidel dluhy celého družstva, které mu
  server posílat odmítá. Řeší to `startSession()` v `app/session.tsx`; každá
  nová cesta k přihlášení musí jít přes ni. Napříč **záložkami** to nechrání:
  refresh cookie je společná pro celý prohlížeč, takže na testování víc rolí
  patří oddělené profily nebo anonymní okna, ne dvě záložky.
- **Kalendář se odebírá, nestahuje, a spravuje se jen v profilu.** Klientský
  generátor `.ics` už neexistuje; odběr celé sezóny vydává server a jediné místo,
  kde se zakládá a ruší, je `CalendarFeedsCard` v `/ja`. Do kalendáře ani do
  detailu akce tlačítko nepatří — je to jednorázové nastavení telefonu, ne
  součást provozu. Token se drží jen v otevřeném dialogu a při zavření se maže
  i z mutation cache; ze serveru ho podruhé získat nejde.
- **Service worker cachuje jen shell, žádná data.** Přednačítá statické soubory
  a navigaci, takže se aplikace spustí i bez signálu — ale skončí na přihlášení,
  protože bez sítě se relace obnovit nedá. **Odpovědi API se necachují ani ke
  čtení** a zápisy se nikdy nefrontují. Zkoušelo se to a nestálo to za nic:
  klíčovat soukromou cache podle relace nejde (access token je po každém startu
  jiný, takže by nikdy netrefila) a bez toho by v zařízení jen ležela cizí data
  za nulový užitek. Nový service worker čeká na potvrzení ve `PwaUpdatePrompt`.

- **Obrázek nikdy nestojí sám za informaci.** `Avatar` dostane `src` a při chybějícím
  nebo nenačteném obrázku spadne na iniciály, respektive na číslo dresu; je
  `aria-hidden`, protože jméno stojí vedle. `TeamLogo` se chová stejně vůči
  `ClubMark`. Proto se `src` nikam nepodmiňuje — komponenta si `null` i rozbitou
  adresu vyřídí sama.

  **Znak se vepisuje (`object-contain`), tvář se oseká (`object-cover`).**
  Znaky jsou skoro vždycky na šířku a server je tak i ukládá, takže `object-cover`
  by jim odřízl kraje. Volající zadává znaku jen výšku, šířka dojede podle poměru.

  **Znak je družstva, ne klubu** (`TeamSummary.logoUrl`). `TeamLogo` padá zpátky
  na klubový `ClubMark`, takže družstvo bez znaku vypadá jako dřív.

- **Obrázek se ukládá jako datová URL, ne jako `FormData`.** Klient soubor přečte
  `FileReader`em a pošle ho v JSON těle jako každou jinou mutaci; API nikde jinde
  multipart nepřijímá a kvůli jedné obrazovce se to nezaváděl.

  Předtím ho ale **zmenší na 1024 px přes `<canvas>`**, takže na server nejde
  dvacetimegabajtová fotka kvůli obrázku, ze kterého bude 512 px. Není to jen
  úspora dat: canvas respektuje **EXIF orientaci**, kterou GD na serveru ignoruje,
  takže fotka na výšku by se bez toho uložila položená na bok. Když prohlížeč
  canvas neumí, `downscaled()` vrátí `null` a pošle se původní soubor —
  proto se výsledek nikdy nesmí považovat za jistý. Poměr stran počítá
  `scaledSize()` zvlášť, aby šel testovat bez canvasu.

- **Oprávnění k Push se žádá jen po kliknutí.** Peněžní kategorie jsou
  ve výchozím stavu vypnuté a server je zdroj pravdy; prohlížečový odběr
  se v profilu pouze zaregistruje nebo odregistruje.

  **Kde to nejde, tlačítko se nevykresluje a stojí tam důvod.** Vypnuté tlačítko
  na kliknutí nic neudělá ani nenapíše, takže vypadá jako rozbitá aplikace —
  přesně tak to jednou skončilo. Na počítači instalace potřeba není ani v Safari;
  brání jen iPhone a iPad, kde iOS push povolí až aplikaci na ploše
  (`needsInstallForPush()`).
