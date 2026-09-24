# api/ — pokyny pro agenty

PHP 8.5, vlastní mikro-framework. Bez Laravelu i Symfony záměrně: hosting nemá
SSH ani Composer na serveru, deploy jde přes FTP a celý backend má být tak malý,
aby se dal přečíst za odpoledne. Zdůvodnění je v `docs/ANALYZA-TECHNICKA.md`, kap. 3.

Obecná pravidla projektu jsou v [../AGENTS.md](../AGENTS.md) — hlavně to
o testovací databázi a o e-mailech.

## Tok požadavku

```
public/index.php → Http\Kernel → Http\Router → Controller → Service → Support\Database
```

- **Controller** kontroluje **tvar** vstupu (je to číslo? je to datum? není toho moc?)
  a překládá ho na volání služby. Nesahá na databázi.
- **Service** řeší **pravidla a oprávnění**. Sem patří transakce, validace proti
  datům a všechno, co musí platit bez ohledu na to, odkud volání přišlo.
- **App::routes()** je jediné místo, kde se registrují cesty.

Když se rozhodujete, kam kód patří: kontrola „je `count` mezi 1 a 99" je
controller, kontrola „patří tenhle hráč do toho týmu" je service.

## Autorizace

Každý přístup k záznamu jde přes `Auth\TeamScope`. Nikdy nečtěte roli z tokenu —
`TeamScope` ji bere z databáze, takže odebrané oprávnění platí okamžitě a ne až
po vypršení JWT.

```php
$teamId = $this->scope->writableSeason($identity, $seasonId, Role::Treasurer);
```

Metody vracejí `teamId`, na který se pak dotazy omezují. Cizí nebo neexistující
záznam shodí `ApiException::notFound()` — 403 by prozradilo, že ID existuje.

## Databáze

Všechno přes `Support\Database` (`run`, `first`, `all`, `value`, `transaction`,
`lastInsertId`). **SQL se nikdy neskládá konkatenací s daty.** Kde je potřeba
proměnný počet placeholderů, generuje se z `count()` pole, ne z jeho obsahu —
viz `OffenceService::placeholders()`. Pokrývá to test
`tests/Integration/SqlInjectionTest.php`.

Vícetabulkové zápisy patří do `transaction()`. Půl zapsaného tréninku je horší
než nic, protože se nepozná, co chybí.

## Chyby

Jen `Http\ApiException` a jeho tovární metody (`validation`, `forbidden`,
`notFound`, `conflict`, `tooManyRequests`). Zpráva je česky a určená uživateli,
`details['field']` říká klientovi, u kterého pole ji vypsat. Stará verze vracela
400 na všechno a klient neuměl rozlišit chybný vstup od chybějícího práva.

## Styl

- `declare(strict_types=1)` v každém souboru, třídy `final`, závislosti přes
  `readonly` promoted properties v konstruktoru.
- **Typy jsou závazek, ne ozdoba.** Tvary polí popisujte přes `@phpstan-type`
  aliasy nahoře u třídy a používejte je v návratových anotacích — PHPStan pak
  hlídá, že se payload neroze­jde s tím, co čeká frontend.
- Komentář má vysvětlovat **proč**, ne co kód dělá. Zvlášť u míst, kde se řešil
  konkrétní problém staré verze — ty poznámky jsou tam schválně.
- Statická analýza běží na **level 8** a musí být čistá.
- **Formátování neřešte ručně.** PHP-CS-Fixer podle `.php-cs-fixer.dist.php`
  (PSR-12 + zarovnané `=>` a `=`, seřazené importy, poslední čárka):

  ```bash
  docker compose run --rm php ./vendor/bin/php-cs-fixer fix --dry-run --diff   # kontrola
  docker compose run --rm php ./vendor/bin/php-cs-fixer fix                    # oprava
  ```

  Zarovnávání je zapnuté schválně, i když ho PSR-12 nežádá: kód se tak psal od
  začátku a strojové zrušení by přepsalo 43 z 62 souborů bez užitku. Migrační
  ani `risky` sady se nepoužívají — formátovač má měnit mezery, ne chování.

## Testy

PHPUnit, `tests/Integration/` jede proti skutečné MySQL. Nový nebo změněný
service dostane test — jsou to peníze, ne zobrazení seznamu.

```bash
docker compose run --rm php ./vendor/bin/phpunit
docker compose run --rm php ./vendor/bin/phpstan analyse --memory-limit=512M
```

Testy nesmí sáhnout na skutečný SMTP server. `Mail\Mailer` je proto rozhraní
a v testech se předává `Tests\Support\FakeMailer`, který zprávy jen sbírá —
databáze obsahuje reálné adresy reálných lidí.

Testy si mažou tabulky, takže běží **výhradně proti `pina_test`**. Pojistka je
v `tests/Integration/DatabaseTestCase.php` a neobchází se.

## Na co si dát pozor

- **Idempotence dávek** přes `client_uuid`: opakované odeslání téhož těla musí
  vrátit původní výsledek a nic nezapsat. Souběh řeší unikátní index, ne zámek.
- **Snapshot ceny** do `offence_record.amount_czk`. Dluh se nikdy nepočítá joinem
  na aktuální sazebník.
- **Storno místo mazání** — `voided_at`, `voided_by`.
- **Soupiska sezóny, ne seznam členů.** Členství se kvůli historii nemaže, takže
  družstvo má víc členů, než kolik jich v dané sezóně hrálo (junioři: 48 členů,
  21 na soupisce 25/26). Přehledy proto vycházejí z `roster_entry`. Kdo na
  soupisce není, ale má v sezóně zápis, se ukáže taky — odchod dluh nemaže.
- **Záporné částky jsou platné** (bonusy). Nikde nepředpokládejte, že částka
  nebo součet je kladný.
- **Družstvo nesmí zůstat bez admina.** `TeamService::assertNotLastAdmin` shodí
  odebrání role i odchod poslednímu adminovi (409 `LAST_ADMIN`) — jinak by tým
  neměl kudy se opravit, protože roli uděluje admin téhož družstva.
- **Kdo zakládá, ten je admin.** Družstvo zakládá admin jiného družstva téhož
  klubu a rovnou dostane členství s rolí admin; klub zakládá jen platformní
  admin (`user.is_platform_admin`). Nikde k tomu není pevně zadané ID —
  `LEGACY_PLATFORM_ADMIN_ID` v `tools/migrate_legacy.php` je jen převod historie
  ze staré aplikace a za běhu nic neřídí.
- **Tokeny na jedno použití** (pozvánka, aktivační odkaz) se vrací **jen
  v odpovědi na jejich vytvoření**; v databázi je pouze SHA-256 otisk. Nikam se
  nelogují a zpětně je nelze zobrazit. Proto „poslat znovu" vydává **nový**
  token a ten starý ruší.
- **Odkaz se vrací i po úspěšném odeslání pošty.** Zpráva může skončit ve spamu
  a admin musí mít co poslat do chatu. `emailSent` v odpovědi říká pravdu —
  nikdy netvrďte uživateli, že zpráva odešla, když se jen zapsala do logu.
- **Selhání pošty nesmí shodit operaci.** Pozvánka vznikne i při výpadku SMTP;
  volající se z `emailSent = false` dozví, že odkaz musí předat sám. Výjimka je
  hromadné rozeslání: tam token nikdo nevidí, takže se nedoručená pozvánka zase
  maže — jinak by adresáta na tři dny vyřadila z dalších pokusů.
- **`Mail\Allowlist` je poslední pojistka** mezi vývojem a schránkami skutečných
  lidí. Mimo produkci je prázdný seznam zákaz odesílání.
- **Přijetí pozvánky se ptá na heslo a jméno, jen když je nemá odkud vzít.**
  Hráč přicházející z druhého klubu už účet má — `GET /invitations/{token}`
  (`AuthService::previewInvitation`) appce předem řekne `hasPassword`, takže
  formulář pole rovnou skryje a `acceptInvitation` pošle `password`/`name` jako
  `null`. Dřív appka pole vždycky ukázala a zadané heslo potichu zahodila
  (`COALESCE(password_hash, …)`) — fungovalo to správně, ale vypadalo to jako
  chyba. Validace obou polí je teď v `AuthService`, ne v controlleru: až tam
  se pozná, jestli je účet nový.
- **E-mail patří uživateli, ne členství** — stejně jako jméno. Admin ho opraví
  v `updateMembership`, hlavní případ je zástupná adresa `@pinaprosek.invalid`
  z migrace (na tu nejde vydat aktivační odkaz) nebo obyčejný překlep. Změna
  zruší nevyřízenou pozvánku pro **starou** adresu v tomtéž družstvu — jinak by
  dřív vydaný aktivační odkaz dál platil na chybnou adresu a mohl by ho použít
  někdo jiný. Do `audit_log` jde jen že se e-mail změnil a u koho, ne hodnoty
  samotné — to je osobní údaj a payload je nesmí kopírovat.
- **Členství je `active`, nebo `left`.** Mezistav „pozastaven" byl ze staré verze
  a nic nerozlišoval — kdo v dané sezóně nehraje, prostě není na její soupisce.
- **`tokens_valid_from`** u uživatele zneplatní vydané JWT; používá se při změně
  hesla, odhlášení všude a změně role.
- **Docházka se nezapisuje, jen opravuje.** `event_participant.attendance` je
  záznam o **ruční opravě**, ne o docházce samotné; skutečný stav vrací
  `COALESCE(attendance, IF(rsvp = 'yes', 'present', 'absent'))`. Původní návrh
  počítal s tím, že pínař po každé akci odklikne celý tým — tým to označil za
  práci, kterou nikdo dělat nebude. Z toho plyne pojistka, která se neobchází:
  **RSVP jde měnit jen do začátku akce**, jinak by si hráč druhý den přepsal
  vlastní docházku.
- **Termín pro zápis se dědí živě, pozdní zápis se ukládá jako snapshot.**
  Výsledný termín skládá `Support\RsvpDeadline::sqlExpression()` — ruční hodnota
  u akce, jinak hodiny z nastavení družstva, u družstva bez řádku nastavení
  výchozích 24/48. Ten výraz smí existovat **jen na jednom místě**: podle něj se
  řídí i připomínka, a kdyby se kopie rozešly, push by chodil podle jiného termínu,
  než jaký appka ukazuje. Naproti tomu `event_participant.rsvp_late` se počítá při
  ukládání odpovědi a už se nepřepočítává — posunutý termín nesmí zpětně měnit,
  kdo přišel pozdě, protože z toho plynou peníze.
- **Zranění (`injured`) se nepočítá do jmenovatele** účasti: `present / (present + absent)`.
  Omluvená a neomluvená absence se nerozlišuje — „absence je absence".
- **Kdo přijde, vidí každý; jak akce dopadla, ne.** Odpovědi (`rsvp`, `transport`)
  jsou veřejné, protože bez nich se nedomluví odvozy. Výslednou docházku ostatních
  dostane jen pínař a admin, hráčům ji otevře až `team_settings.attendance_visible_to_players`.
  Hráč vidí v souhrnu vždycky jen svůj řádek. Je to výslovné přání týmu, ne
  technické rozhodnutí — pína je legrace, docházka citlivější věc.
- **Pínař řídí provoz, admin lidi a sezóny.** Pínař zakládá, upravuje, ruší i maže
  akce a série, spravuje místa konání, mění soupisku sezóny a vidí souhrn účasti
  celého družstva — docházku opravuje, takže ji musí i vidět, jinak by opravoval
  naslepo. Adminovi zůstávají **členové a role**, **zakládání, úprava a uzavření
  sezóny** (uzavření je z aplikace nevratné a zamkne všechny zápisy), **přelom
  pololetí**, **nastavení družstva** a **nominace** — ta je o sestavě, ne o provozu.
  Kdo tuhle hranici posouvá, musí ji posunout na obou stranách: `Service` třída
  i podmínka `can()` ve frontendu, jinak uživatel uvidí tlačítko končící 403.
- **Doprava má jen dva stavy: beru auto, nebo neberu.** `transport` je
  `driver`, nebo `none`. Původní `passenger` („svezu se") se od `none` v celé
  aplikaci **nikde nelišil** — nepočítal se, nikde se nezobrazoval, jen zabíral
  třetí knoflík. Následek má výhradně `driver`: podle něj se sčítají volná místa
  a vzniká cesťák. Neznámou hodnotu služba odmítne 400, aby starý klient nespadl
  až na enumu v databázi.
- **Odvozy jen u venkovního zápasu a jen u toho, kdo přijede.**
  `event_participant.transport` se u tréninku, u domácího zápasu i u odpovědi
  „nepřijdu" srovná na `none` — do vlastní haly se každý dopraví sám. Není to chyba 400 —
  přepnutí na „nepřijdu" by jinak spadlo kvůli poli, které uživatel nevidí.
- **Doma se necestuje.** `isHome` v payloadu akce se odvozuje z porovnání
  `event.location_id` s `team_settings.home_location_id`; `null` znamená „nevíme"
  (trénink, chybějící místo, nenastavená hala). U domácího zápasu se `distance_km`
  zahazuje, aby z něj nemohl vzniknout cesťák za cestu do vlastní haly.
- **Série se materializuje celá při založení.** Sezóna ji ohraničuje, takže
  termínů jsou desítky; žádné klouzavé okno ani plánovaná úloha.
- **Hromadná změna série má dva rozsahy:** `following` (od zadaného termínu dál)
  sérii **rozštěpí** — původní skončí den před hranicí a od ní platí nová, takže
  stará pořád popisuje, jak se hrálo předtím. `all` přepíše sérii celou, minulé
  termíny včetně. Termín, který zůstane na stejném datu, se **jen upraví**, takže
  posun času neshodí odpovědi hráčů; mažou a zakládají se jen ty, kterým se datum
  posunulo. Ručně upravený (`overridden`) termín se přeskočí a spočítá do `skipped`.
- **Smazat znamená smazat.** `DELETE /events/{id}` i smazání série berou i termíny
  s odpověďmi, u rozsahu `all` i minulé; docházka jde s nimi. Peníze ne —
  `offence_record.event_id` i `offence_batch.event_id` jsou ON DELETE SET NULL,
  takže zápis přežije bez akce. Zrušení (`status = 'cancelled'`) je něco jiného:
  akce zůstane v kalendáři s cedulí, aby tým věděl, že se nehraje.
- **Prohřešek z docházky se navrhuje, nezapisuje.** Který to je, říká
  `offence_type.auto_rule` (omluvená / neomluvená absence) **spolu s**
  `auto_event_type` (trénink / zápas / jiná / všechny). Obojí je nutné: sazba za
  omluvený trénink a omluvený zápas se u všech tří družstev liší i o stovky.
  Přednost má pravidlo pro konkrétní druh akce před `any`; když pro daný případ
  žádné není, radši se nenavrhne nic, než aby se strhla částka z té druhé položky.
  Pozdní příchod se odvodit nedá — čas příchodu nikdo nezapisuje.
- **Nominace má jen dva stavy: jede, nebo náhradník.** Kdo je na soupisce, na
  zápas jede, dokud ho admin nebo pínař neoznačí za náhradníka — `none` ve sloupci
  se čte jako „jede", ne jako „nejede". Třetí stav by nutil odklikat celý tým.
  `saveNominations` mění **jen poslané hráče** a po změně skryje nominaci hráčům;
  admin nebo pínař ji potom zveřejní samostatným tlačítkem. U tréninku je
  nominace vždycky `none` — nominovat na trénink je zbytečná byrokracie.
  Post hráče je nepovinný (`S`, `U`, `B`, `N`, `L`); mění ho stejná role a platí
  pro něj stejné skrytí do zveřejnění.
- **Doprava se opravuje zpětně stejně jako docházka.** Odpověď je po začátku akce
  zamčená, takže kdo zapomněl říct, že jede autem, by se k cesťáku nedostal —
  `saveAttendance` proto bere u venkovního zápasu i `transport`. Chybějící pole
  nechává dopravu být (oprava docházky odvozy nepřepisuje) a u nepřítomného se
  srovná na `none`, jinak by zůstal nárok za cestu, která se nestala.
- **Cesťák vzniká jen řidiči venkovního zápasu.** `syncTravelClaims` porovnává
  `event.location_id` s domácí halou, **ne** jen `distance_km > 0` — vzdálenost může
  ve sloupci zůstat z doby, kdy hala ještě nastavená nebyla, a `EventService` ji
  zahazuje až v payloadu. Kdo přehodí podmínku na samotnou vzdálenost, proplatí
  cestu do vlastní haly. Sazba se ukládá jako snapshot, takže pozdější změna
  sazebníku nepřepočítá už vzniklý nárok.
- **Dvojzápas nese vzdálenost i řidiče jen na jedné ze dvou akcí.** Tým hraje
  skoro vždy dva zápasy na jeden výjezd, zapsané jako dvě samostatné `event`
  položky. `event.travel_link_event_id` (nullable, self-FK) označí tu
  "vedlejší" — na tu "hlavní", která jediná smí mít `distance_km` a účastníky
  s `transport = 'driver'`. `EventService::create`/`update` proto na napojené
  akci vzdálenost vždy zahodí na `NULL` bez ohledu na vstup a `saveRsvp`/
  `saveAttendance` na ní `transport` vždy srovná na `none` — stejně tiše jako
  u domácího zápasu, ne chybou. Díky tomu `syncTravelClaims` nemusí o
  dvojzápasu vůbec vědět: řidič je zapsaný jen jednou, takže cesťák vznikne
  jen jednou. Odkaz smí mířit jen na zápas, který sám na nic neodkazuje
  (žádné řetězení) a který ještě nemá vlastní navazující akce (nejde být
  hlavní i vedlejší zároveň) — `assertTravelLink` obojí hlídá. Docházka,
  RSVP i prohřešky zůstávají u obou akcí úplně nezávislé, `offence_batch`
  ostatně na `event_id` žádné omezení 1:1 nemá.
- **Storno cesťáku sync nevrací.** Načtení z odehraných zápasů čte i stornované
  řádky právě proto, aby je nezaložilo znovu; storno je rozhodnutí pínaře.
  Naopak nárok, u kterého řidič odpadl (oprava docházky, zrušený zápas,
  hala se stala domácí), se při dalším načtení stornuje sám.
- **QR je do koruny stejné číslo jako zůstatek na kontě.** Počítá se přes
  `seasonBalance`, tedy bez filtru na `occurred_on` — datum zápisu klidně padne
  mimo rozsah sezóny (turnaj před jejím začátkem) a hráč nesmí dostat QR na
  nižší částku, než jakou vidí.
- **Pololetí je členění, ne uzávěrka.** `season.half_year_on` je jen datum, podle
  kterého se čísla dělí; nic se nezamyká. Tabulky `settlement` a `settlement_line`
  jsou proto **zrušené** — snímek uzávěrky tým odmítl, nechtěl si nechat svázat ruce.
  Předvyplní se 1. lednem, který padne do sezóny (`defaultHalfYear`),
  a musí ležet **uvnitř** sezóny, ne na jejím okraji — jinak by jedna polovina
  byla prázdná. `NULL` znamená, že se pololetí neřeší, a `balances` pak neposílá
  ani `halves`, ani přepínač období.

  Plyne z toho, co pololetí **nedokáže**: platba se počítá do toho pololetí,
  kdy přišla, ne kam patřila. Proto QR pořád vyzývá k celému nedoplatku sezóny
  a jeho popis se jmenuje „Nedoplatek 25/26", ne „1. pololetí" — nesmí slibovat,
  že se strhne jen polovina. Bez uzávěrky to jinak nejde a předchozí `settlement_period`
  u družstva to jen předstíralo.
- **Součet obou polovin musí dát celou sezónu.** `balances` proto ploché hodnoty
  nepočítá samostatným dotazem, ale sečtením `halves` — jinak by se dvě čísla na
  téže obrazovce rozešla. Peníze se čtou třemi dotazy (zápisy, platby, cesťáky)
  s `GROUP BY membership_id, half`; nikdy nejoinujte ty tři tabulky naráz,
  násobí se řádky.
- **Účet pro QR patří družstvu.** `team_settings.bank_account`; každé družstvo má
  vlastní kasu, takže i vlastní účet. Do F5 ležel na klubu a editoval se
  v nastavení družstva — změna u mužů tím tiše přepsala účet juniorům i kadetům.
  Při přechodu na účty družstev se každému družstvu zkopíroval, takže se nic neztratilo.
  Uložení nastavení je úplná náhrada: co klient nepošle, se smaže — stejně jako
  u ostatních polí. Formát hlídá `Support\CzechBankAccount` (číslo účtu i český
  IBAN), SPAYD potřebuje IBAN.

  **Družstvo bez uloženého nastavení nemá v `team_settings` řádek**, ne prázdné
  hodnoty. Čte se přes `LEFT JOIN` a výchozí hodnoty jsou v kódu; kdo sáhne na
  tuhle tabulku migrací, musí počítat s tím, že `UPDATE` taková družstva minul.
- **Jediná ponechaná rezerva je bankovní párování.** `bank_transaction`
  a `payment.bank_transaction_id` zatím zůstávají; o realizaci není rozhodnuto.
  Přehled oznámení v aplikaci ani platební brána nejsou v rozsahu. Nepřidávejte
  pro ně prázdné sloupce ani hodnoty enumů. Push používá `notification` a frontu
  po zařízeních, bez příznaku přečtení.

  Stejná past má druhou podobu: sloupec, který se **zapisuje, ale nikdo ho nečte**.
  Vypadá živě, a přitom je to jen osobní údaj bez účelu. Takhle zmizely
  `refresh_token.user_agent` a `.ip` (měly sloužit obrazovce „přihlášená
  zařízení", která nevznikla), `user.last_login_at` a úspěšné
  řádky v `login_attempt`. Nic z toho `audit_log` nenahradil a nemá nahrazovat:
  ten zaznamenává rozhodnutí o penězích a oprávněních, ne přihlašování.
- **Audit patří do stejné transakce jako změna.** Volá se viditelně ze
  služeb přes `Service\AuditLog`; controller ani databázový obal ho nedoplňuje.
  Peníze a oprávnění se vážou na `team_id`, ne na klub. JSON payload nesmí
  kopírovat jména, e-maily, telefony ani tokeny — ukládá ID a starou i novou
  hodnotu, lidské názvy se dohledávají při čtení. Stopa je jen pro skutečného
  admina daného družstva nebo správce v ověřeném režimu podpory tohoto družstva;
  samotná platformní role ji neotevírá.
- **`login_attempt` drží jen nepovedené pokusy a jen 24 hodin.** Limiter počítá
  výhradně selhání, takže úspěšné přihlášení do žádného počtu nevstupuje — byl by
  z něj trvalý seznam „kdo se odkud a kdy přihlásil". Staré řádky maže sám
  `RateLimiter` při zápisu, plánovanou úlohu to nepotřebuje. Adresa se ukládá
  zabalená (`inet_pton`) a čte se **jen** kvůli limitu 20 selhání za 15 minut.
- **Provozní úklid má rezervu 365 dní.** `MaintenanceService::cleanup` volá
  ověřený cron oznámení po `flush`, i během nočního klidu a bez zapnutého push.
  Refresh tokeny, reset hesla a pozvánky se mažou až rok po expiraci a případném
  pozdějším zneplatnění/použití/přijetí. Kalendářové odběry až rok po zrušení;
  samotné stáří ani neaktivita nejsou důvodem ke smazání platného odběru.
  Staré zprávy lze smazat jen bez fronty. Doručení musí být `sent` se starým
  `sent_at`, nebo `failed`; datum zprávy i `send_after` musí být starší než rok
  a `locked_at` prázdné. `pending` ani `processing` se automaticky nemažou.
  Limit je 500 řádků z každé tabulky za běh; žádná smyčka „dokud je co mazat“.
  Výsledek cronu obsahuje jen počty v `cleanup`, ne tokeny ani osobní údaje.
  Audit, peníze, účty, členství, platné push odběry a preference do úklidu nepatří.
- **Kdo nevidí cizí dluhy, nevidí ani položky, ze kterých vznikají.**
  `team_settings.balances_visible_to_players` řeší `Service\FinancialAccess` na
  jednom místě a platí na zůstatky, zápisy, dávky, platby i cesťáky — jinak by
  se cizí částka dala přečíst z detailu dávky. Provozní správce bez členství
  v družstvu musí pro plný přístup výslovně vstoupit do režimu podpory.
- **Vypnutá docházka je zákaz nových zápisů, ne mazání historie.**
  `Service\AttendanceModule` vrací výchozí „zapnuto" přes `LEFT JOIN` a
  `COALESCE`, protože většina družstev nemá v `team_settings` žádný řádek.
  Zápisové operace akcí, synchronizace cesťáků a vydání kalendářového odběru
  vracejí 409 `ATTENDANCE_DISABLED`; čtení zůstává funkční a žádné akce,
  odpovědi, pravidla ani peněžní vazby se při vypnutí neupravují. Připomínky
  akcí se pro takové družstvo nezakládají, ale už existující fronta, osobní
  preference oznámení ani odběry kalendáře se nemažou.
- **Obnova hesla nesmí prozradit, kdo je registrovaný.** `/auth/password/forgot`
  odpovídá stejně pro známou i neznámou adresu; i překročený limit se mlčí.
  Odkaz platí hodinu (přepisuje existující heslo) a vydává se jen samoobslužně —
  admin heslo zrušit nemůže, jinak by šlo převzít cizí účet.
- **Adresa odběru kalendáře je heslo.** `calendar_feed` drží jen SHA-256 otisk
  tokenu a veřejný endpoint při každém načtení znovu ověří živé členství.
  Zneplatněný odběr i bývalý člen dostanou 404. ICS skládá jedině
  `Support\IcsCalendar`; nesmí obsahovat poznámku, jména, docházku ani peníze.
  Stabilní UID a `ETag` jsou podmínka, aby se přesunutá akce aktualizovala a
  kalendáře zbytečně nestahovaly celou sezónu.
- **Push se nikdy neposílá v doménovém požadavku.** Zápis dávky vloží
  `notification` a frontu v téže databázové transakci; síť volá až chráněný
  cron. Fronta je po jednotlivých `push_subscription`, hlídá deduplikaci,
  noční klid 23:00–8:00 a při `404`/`410` mrtvý odběr smaže. Odběr se drží
  po `push_subscription.device_id` (náhodné id prohlížeče z localStorage), ne
  po adrese: tu push služba při každé nové registraci service workera mění,
  takže bez toho po sobě jedno zařízení nechává mrtvé řádky a aplikace pak
  tvrdí „aktivní na jiném zařízení". Nová kategorie
  oznámení bez samostatného souhlasu majitele nesmí vzniknout. Odhlášení
  ze všech zařízení maže i všechny push odběry daného účtu.

- **Nahraný obrázek se nikdy neuloží tak, jak přišel.** `ImageService` ho přes GD
  převzorkuje do vlastního PNG, takže z něj spadnou EXIF údaje (včetně polohy)
  i cokoli, co se v souboru vezlo. Profil se oseká na čtverec, znak klubu se
  vepíše celý — znak na šířku by výřezem přišel o kraje. Z animovaného GIFu
  zůstane první snímek. Limity (4 MB, 16 Mpx) jsou **záložní**, protože obrázek
  zmenšuje už prohlížeč; drží paměť, ne přenos: GD si obrázek rozbalí na 4 bajty
  na pixel a `memory_limit` je 128 MB. Výš je zvednout nejde, base64 je o třetinu
  delší než soubor a `post_max_size` je 8 MB. Formát se ověřuje třikrát (hlavička
  data URL, `getimagesizefromstring` a `gd_info`), protože GD přeložené bez JPEG
  vypadá funkční a na fotku vrátí jen `false`.
- **EXIF orientaci řeší klient, ne server.** GD ji ignoruje, takže fotka nafocená
  na výšku by se uložila položená na bok; `<canvas>` v prohlížeči ji respektuje
  a odesílá už srovnaný obrázek. Kdo by zmenšování na klientu vypnul, musí
  otočení dodělat tady.
- **Znak patří družstvu, ne klubu, a cesta k souboru se nesmí kopírovat.** Dvě
  družstva se stejnou cestou by si po první výměně znaku navzájem smazala soubor
  — `deleteStoredFile` maže starý po každém uložení. Proto se při přechodu na znaky družstev
  schválně nedědil: kdo znak chce, nahraje si ho, a bez něj se kreslí klubový
  `ClubMark`.
- **Soubory leží mimo databázi a jejich adresa je oprávnění.** V tabulce je jen
  cesta, obsah v `api/storage/images/`. Endpoint je **veřejný** — `<img>` nemůže
  poslat hlavičku `Authorization` a access token se drží jen v paměti, takže
  autorizace se dělá jinak: název souboru je 128 bitů náhody a při každé výměně
  vzniká nový. Kdo adresu nezná, obrázek nenajde; kdo ji zná, si ho přečte i po
  odchodu z družstva. Je to fotka, kterou si člověk nahrál sám, ne peníze —
  ale ukládat sem cokoli citlivějšího by tenhle model neunesl.
  Záloha databáze obrázky **neobsahuje**.

## Nasazení

Hosting nemá SSH. `api/src`, `api/vendor` a `.env` se nahrávají **nad web root**
(`open_basedir` tam sahá, internet ne), `api/public/*` do `public_html/api/`.
Composer se pouští lokálně a `vendor/` se nahrává hotové.

- **Telefon si vyplňuje hráč v profilu.** `user.phone` je nepovinný kontakt ve
  tvaru `+420` a devíti číslic. Čte jej vlastník v `/me` a skutečný aktivní admin
  daného družstva v seznamu členů. Hráč, pínař ani samotný provozní správce
  cizí číslo nedostane; správce je uvidí až v ověřeném režimu podpory daného
  družstva. Telefon nepatří do auditu.

### Úklid nepoužívaného schématu

Nové databáze zakládejte z `db/migrations/001_init.sql`. Pro existující DB je
`tools/cleanup_unused_schema.php` (CLI): bez parametrů ukáže SQL, `--apply` ho
provede. Nejprve nahrajte nové API — staré čte `team.color` a zapisuje kanál fronty.
Před spuštěním pořiďte zálohu DB. Kontroly proběhnou před prvním DDL; nalezená
používaná data úklid zastaví. MySQL DDL není transakční, nástroj lze po technickém
selhání spustit znovu. Opakované spuštění už dokončené změny přeskočí.
Na hostingu zavolejte `CleanupUnusedSchema::run()` z dočasného zaheslovaného
skriptu podle postupu v README a potom tento veřejný skript smažte.
