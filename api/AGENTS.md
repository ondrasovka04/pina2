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
  nelogují a zpětně je nelze zobrazit.
- **`tokens_valid_from`** u uživatele zneplatní vydané JWT; používá se při změně
  hesla, odhlášení všude a změně role.

## Nasazení

Hosting nemá SSH. `api/src`, `api/vendor` a `.env` se nahrávají **nad web root**
(`open_basedir` tam sahá, internet ne), `api/public/*` do `public_html/api/`.
Composer se pouští lokálně a `vendor/` se nahrává hotové.
