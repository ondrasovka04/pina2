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
- **Zranění (`injured`) se nepočítá do jmenovatele** účasti: `present / (present + absent)`.
  Omluvená a neomluvená absence se nerozlišuje — „absence je absence".
- **Kdo přijde, vidí každý; jak akce dopadla, ne.** Odpovědi (`rsvp`, `transport`)
  jsou veřejné, protože bez nich se nedomluví odvozy. Výslednou docházku ostatních
  dostane jen pínař a admin, hráčům ji otevře až `team_settings.attendance_visible_to_players`.
  Souhrnná procenta jsou výhradně pro admina. Je to výslovné přání týmu, ne
  technické rozhodnutí — pína je legrace, docházka citlivější věc.
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
  zápas jede, dokud ho admin neoznačí za náhradníka — `none` ve sloupci se čte
  jako „jede", ne jako „nejede". Třetí stav by jen nutil admina odklikat celý
  tým. `saveNominations` proto mění **jen poslané hráče**, nepřepisuje zbytek:
  klient posílá jedno jméno po kliknutí. U tréninku je nominace vždycky `none` —
  nominovat na trénink byla vyhodnocená jako zbytečná byrokracie.
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
- **Účet pro QR patří klubu, ne družstvu.** `club.bank_account` sdílí všechna
  družstva klubu, i když se edituje v nastavení družstva. Uložení nastavení je
  úplná náhrada: co klient nepošle, se smaže — stejně jako u ostatních polí.
  Formát hlídá `Support\CzechBankAccount` (číslo účtu i český IBAN), SPAYD
  potřebuje IBAN.
- **Prázdné tabulky ve schématu jsou schválně, ale jen tyhle.** `bank_transaction`
  (+ `payment.bank_transaction_id`) čeká na F6 párování plateb z banky,
  `notification`, `notification_pref`, `notification_queue` a `push_subscription`
  na F5 Web Push, `audit_log` na provozní auditní stopu. `payment.method = 'gateway'`
  drží místo platební bráně. Nic jiného ve schématu ležet nemá — kdo přidá sloupec
  „na potom", vyrobí past: PHPStan ani testy nepoznají, že se nikdy neplní.
- **Kdo nevidí cizí dluhy, nevidí ani položky, ze kterých vznikají.**
  `team_settings.balances_visible_to_players` řeší `Service\FinancialAccess` na
  jednom místě a platí na zůstatky, zápisy, dávky, platby i cesťáky — jinak by
  se cizí částka dala přečíst z detailu dávky. Provozní správce bez členství
  v družstvu se přes tyhle obrazovky do cizího klubu nedostane.
- **Obnova hesla nesmí prozradit, kdo je registrovaný.** `/auth/password/forgot`
  odpovídá stejně pro známou i neznámou adresu; i překročený limit se mlčí.
  Odkaz platí hodinu (přepisuje existující heslo) a vydává se jen samoobslužně —
  admin heslo zrušit nemůže, jinak by šlo převzít cizí účet.

## Nasazení

Hosting nemá SSH. `api/src`, `api/vendor` a `.env` se nahrávají **nad web root**
(`open_basedir` tam sahá, internet ne), `api/public/*` do `public_html/api/`.
Composer se pouští lokálně a `vendor/` se nahrává hotové.
