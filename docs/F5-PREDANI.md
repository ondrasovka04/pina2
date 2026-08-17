# F5 — předání

Zadání pro toho, kdo bude psát F5. Fáze má tři části: **odběr kalendáře**,
**PWA** a **Web Push**. Jsou nezávislé, dělají se v tomhle pořadí a každá se dá
odevzdat samostatně.

Nejdřív si přečti [AGENTS.md](../AGENTS.md), [api/AGENTS.md](../api/AGENTS.md)
a [web/AGENTS.md](../web/AGENTS.md) — jsou tam pravidla, konvence a seznam pastí,
do kterých už někdo šlápl. Tenhle soubor je nenahrazuje, jen popisuje F5.

Aplikace běží v produkci, spravuje reálné peníze reálných lidí a v databázi je
přes sto skutečných e-mailových adres. Z toho plyne většina omezení níž.

## Pravidla, která se v F5 poruší nejsnáz

1. **Nová kategorie zpráv potřebuje souhlas majitele.** Pošta je povolená jen na
   pozvánky a aktivace; pro **Web Push** majitel 17. 8. 2026 povolil čtyři
   kategorie, každou jako **volbu jednotlivce** (viz část 3). Cokoli mimo ten
   seznam — souhrny, marketing, oznámení pro celý klub — potřebuje nový souhlas.
   Napsat kód jde vždycky, rozeslat jen to, co je na seznamu a co si člověk zapnul.
2. **Odběr kalendáře je jediná část aplikace dostupná bez přihlášení.** Všechno
   ostatní chrání token v hlavičce a `TeamScope`. Tady oprávnění nese sama adresa,
   takže se s ní musí zacházet jako s heslem.
3. **Testy běží jen proti `pina_test`.** Pojistka v `DatabaseTestCase` shodí test,
   pokud název databáze neobsahuje „test" — tabulky se před během promazávají.
4. **Osobní údaje se necommitují.** Dumpy, `*.sql` (kromě `api/db/migrations/*.sql`),
   `*.csv`, `.env`.
5. **Česky se píše všechno, co čte člověk** — UI, komentáře, chybové hlášky,
   commit messages. Anglicky zůstávají jen identifikátory v kódu a názvy sloupců.
6. **Necommitovat a nepushovat bez pokynu.** Práce se odevzdává jako diff.

## 1. Odběr kalendáře (`webcal://`)

### Proč

Dneska si jde rozpis stáhnout jako soubor `.ics` (`AddToCalendarButton`). Je to
**snímek**: když se trénink přesune, v telefonu zůstane starý čas, dokud si
člověk soubor nestáhne znovu. Odběr je proti tomu adresa, kterou si kalendář sám
občas načte, takže se změna propíše bez zásahu.

Zádrhel je v tom, že **kalendář v telefonu se neumí přihlásit**. Neposílá token
ani neprojde přihlašovacím formulářem — sáhne na adresu a čeká `text/calendar`.
Celé oprávnění tedy musí nést sama adresa, a ta se pak povaluje v nastavení
telefonu a v zálohách.

### Co udělat

1. **Tabulka `calendar_feed`** — `user_id`, `team_id`, `season_id`, SHA-256 otisk
   tokenu, `created_at`, `last_used_at`, `revoked_at`. Token se vydá jednou,
   v databázi zůstane jen otisk. Vzor je v `api/src/Auth/PasswordResetService.php`:
   `bin2hex(random_bytes(32))` se pošle, `hash('sha256', $token)` se uloží.
   Migrace jde do `api/db/migrations/` a **zároveň se ručně aplikuje na `pina`
   i `pina_test`** — nasazení ještě neproběhlo, takže `001_init.sql` je stav
   schématu, ne historie.
2. **Token na člověka a družstvo**, ne jeden sdílený na tým. Jinak by kalendář
   četl i ten, kdo z družstva dávno odešel.
3. **Veřejný endpoint** `GET /api/v1/calendar/{token}.ics`. Registruje se
   v `api/src/App.php` s `auth: false` — stejně jako `auth/login` nebo
   `invitations/accept`. Musí:
   - ověřit otisk a odmítnout zneplatněný token (`revoked_at`),
   - **zkontrolovat trvající členství** — samotný token nestačí, kdo z družstva
     odešel, nemá co číst,
   - omezit četnost dotazů; `api/src/Http/RateLimiter.php` existuje, ale je
     napsaný na přihlašování (tabulka `login_attempt`, limit per e-mail a IP),
     takže se buď zobecní, nebo se vedle něj postaví vlastní,
   - poslat `ETag` a odpovědět `304`, aby se nepřenášelo osmdesát akcí pokaždé —
     kalendáře se ptají po hodinách a je jich tolik, kolik má tým telefonů,
   - zapsat `last_used_at`, ať jde poznat mrtvý odběr.
4. **`Response` umí jen JSON.** `api/src/Http/Response.php` má
   `Content-Type: application/json` napevno a tělo protahuje `json_encode`.
   Pro `text/calendar` je potřeba přidat variantu s vlastním typem a surovým
   tělem — ne obcházet `Response` přímými `header()`/`echo` v controlleru.
5. **Formát ICS už je vyřešený**, ale v TypeScriptu:
   `web/src/features/events/ics.ts` (+ `ics.test.ts`). Serverová verze ho musí
   zrcadlit, ne si vymyslet vlastní pravidla — hlavně:
   - `UID` ve tvaru `pina-event-{id}@pinaprosek.eu`, **stabilní mezi načteními**,
     jinak kalendář udělá z posunutého tréninku druhou položku,
   - čas jako plovoucí, bez `Z` a bez zóny (všechny akce jsou v Europe/Prague),
   - `\r\n` na konci každého řádku (jinak to Outlook odmítne) a lámání dlouhých
     řádků,
   - escapování `;`, `,`, `\` a nových řádků.
6. **Obsah bez citlivých údajů** — místo, čas, soupeř, sraz. Žádná docházka,
   dluhy ani jména. Tenhle soubor může skončit ve sdíleném rodinném kalendáři.
7. **Správa v profilu** (`web/src/features/profile/`) — odkaz `webcal://`, který
   na iOS i Androidu otevře rovnou dialog pro přidání, a hlavně možnost odběr
   **zneplatnit**. Při ztrátě telefonu je to jediná obrana. Adresa se ukáže jen
   jednou, stejně jako pozvánka; vzor chování je `OneTimeLinkDialog`.

### Hotovo, když

- Odběr přidaný do kalendáře v telefonu ukáže akce sezóny a po přesunutí termínu
  se sám opraví.
- Zneplatněný token vrátí `404` (ne `403` — nemá prozradit, že existoval).
- Token cizího družstva nebo bývalého člena nevydá nic.
- Ve feedu není ani jedno jméno, částka nebo docházkový stav.
- Testy pokrývají: platný token, zneplatněný, ukončené členství, `ETag`/`304`,
  a že se otisk v databázi nedá vyměnit za token.

## 2. PWA

`vite-plugin-pwa` **je v `package.json`, ale není zapojený** — `web/vite.config.ts`
ho nenačítá a v `web/public/` není manifest. Ikony existují
(`favicon.svg`, `favicon-32.png`, `apple-touch-icon.png`).

Co udělat:

1. Plugin do `vite.config.ts`, manifest (`name`, `short_name` „Pína", `display:
   standalone`, ikony, `start_url`).
2. **`theme-color` si nevymýšlej.** `web/index.html` ho přepisuje skriptem podle
   zvoleného motivu a hodnota musí odpovídat `--color-surface-0`. Manifest s tím
   nesmí válčit.
3. **Offline jen pro čtení.** Aplikace spravuje peníze; rozepsaná dávka
   prohřešků se **nesmí** ukládat do offline fronty a odesílat na pozadí.
   `clientUuid` je idempotence pro opakovaný pokus, ne pro synchronizaci na
   pozadí. Cachovat se má aplikační shell a nejnutnější čtení, nic víc.
4. **Nová verze musí umět vynutit načtení.** Frontend a API se vyvíjejí spolu;
   service worker, který drží starý bundle, rozejde klienta se serverem. Chce to
   viditelnou výzvu „je nová verze, načíst".
5. Deploy jde přes FTP (`web/dist/*` do `public_html/`) a v `web/public/` je
   `.htaccess` — service worker i manifest musí být dostupné z korenu a nesmí je
   sežrat přepis adres na `index.html`.

## 3. Web Push

**Nic z toho zatím neexistuje.** Bez části 2 nemá smysl začínat: **na iOS push
funguje jen u aplikace přidané na plochu** a potřebuje service worker z PWA.

### Co se posílá — rozhodnuto 17. 8. 2026

Čtyři kategorie a **každá je volba jednotlivce**, ne nastavení družstva. Nikdo
nesmí zapnout oznámení někomu jinému.

| Kategorie | Kdy | Komu |
|---|---|---|
| Neodpověděl jsi na blížící se akci | večer před akcí | jen těm, kdo nemají `rsvp` |
| Zveřejněná nominace | při zveřejnění sestavy | nominovaným |
| Nový zápis do píny | při založení dávky | tomu, koho se zápis týká |
| Upomínka na dluh | měsíčně | kdo má kladný zůstatek |

Rozhodnutí, která k tomu patří:

- **Výchozí stav:** po přihlášení k odběru zapnuté první dvě, obě peněžní vypnuté.
  Upomínka na dluh se musí **aktivně zapnout** — u pošty jsou upomínky bez
  zvláštního souhlasu zakázané a push je otravnější než e-mail. Je to jedna
  konstanta, dá se to změnit, ale ne mlčky.
- **Nic v noci.** Neposílat před 8:00 a po 21:00; co vyjde mimo, počká.
- **Jednou a dost.** Odeslání se zapisuje na trojici (člověk, akce, kategorie),
  jinak hodinový cron pošle připomínku pokaždé, co se probudí.
- **Vypnutí musí zabrat okamžitě**, i když je v běhu dávka odesílání.

### Čím se to spustí — rozhodnuto 17. 8. 2026

**Chráněný endpoint volaný plánovačem úloh v administraci Czechie.** Plánovač na
tarifu **je** a počtem úloh nevypadá omezený (ověřeno 17. 8. 2026), takže se
nemusí všechno mačkat do jednoho volání. Z toho plyne:

- endpoint s tokenem v `.env`, dávkově kvůli limitu 30 s, idempotentní (druhé
  zavolání ve stejnou minutu nesmí poslat nic dvakrát),
- **žádný GitHub Actions workflow.** Analýza ho zmiňuje jako záložní variantu
  (kap. 7.1), ale majitel chce plánovač hostingu — do CI se nesahá.

Dvě úlohy, ne jedna univerzální:

| Úloha | Interval | Co dělá |
|---|---|---|
| odeslání fronty | nejkratší povolený (ideálně 15 min) | vyprázdní frontu oznámení |
| upomínky na dluh | měsíčně | založí upomínky těm, kdo dluží |

**Oznámení se nesmí posílat uvnitř požadavku, který je vyvolal.** Nominace
i nový zápis vznikají v běžném požadavku, ale push služba je cizí server —
kdyby byla pomalá nebo mimo, zdržela by nebo shodila zápis peněz. Do databáze se
proto zapíše záznam do fronty a odešle ho až úloha. Cenou je zpoždění do jednoho
intervalu; u zápisu ani nominace to nikomu nevadí, u připomínky před akcí taky
ne, protože se posílá večer předem.

Připomínka před akcí se **nezakládá do fronty dopředu na týdny** — úloha se
pokaždé podívá, které akce jsou zítra a kdo na ně neodpověděl. Kdyby ležela ve
frontě předem, poslala by se i po odpovědi nebo po zrušení akce.

### Technicky

VAPID klíče do `.env` (**necommitovat**), tabulka `push_subscription`
(`user_id`, endpoint, klíče, `created_at`, `last_seen_at`, `failed_at`) a volby
kategorií na uživatele. Na straně prohlížeče `PushManager` + service worker z PWA.
Mrtvý odběr (`410 Gone` od push služby) se musí mazat, jinak se fronta zanese.

V oznámení **nesmí být částka ani jméno cizího člověka** — text se zobrazí na
zamčené obrazovce, kterou vidí kdokoli kolem.

### Hotovo, když

- Člověk si v profilu zapne kategorii, dostane oznámení, vypne ji a už nic nechodí.
- **Push služba mimo provoz nezdrží ani neshodí zápis dávky** — oznámení jen leží
  ve frontě, dokud služba nenaběhne.
- Odhlášený telefon (`410`) zmizí z databáze sám.
- Opakované zavolání endpointu nepošle druhou kopii.
- Nic neodejde mezi 21:00 a 8:00.
- Testy pokrývají výchozí stav voleb, potlačení v noci, deduplikaci a mazání
  mrtvých odběrů.

## Jak se to ověřuje

```bash
docker compose up -d
docker compose run --rm php ./vendor/bin/phpunit
docker compose run --rm php ./vendor/bin/phpstan analyse --memory-limit=512M
docker compose run --rm php ./vendor/bin/php-cs-fixer fix --dry-run --diff

cd web && npm run typecheck && npm run lint && npm run format && npm test -- --run
```

Před odevzdáním musí projít testy i statická analýza té části, které se změna
týká. Výchozí stav: **284 testů na backendu, 191 na frontendu, PHPStan level 8
bez chyb.**

## Co nedělat

- Neposílat žádnou kategorii oznámení mimo ty čtyři z části 3 a žádný e-mail mimo
  pozvánky a aktivace.
- Nesahat do CI. Spouštěč je cron hostingu, ne GitHub Actions.
- Nesahat na `settlement`/uzávěrku — pololetí je **jen členění podle data**, nic
  se nezamyká, tabulky pro snímek byly zrušené schválně.
- Nezavádět druhý generátor ICS s vlastními pravidly.
- Nedávat do feedu nic, co by nemělo skončit v cizím kalendáři.
- Neobcházet `TeamScope`. Cizí záznam vrací `404`, ne `403`.
