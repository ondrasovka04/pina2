# Pína 2.0 — Funkce a rozhodnutí

**Přehled funkcí a rozhodnutí týmu. Bez technických detailů.**
Původní návrh: 14. 8. 2026 · Aktualizace: 17. 9. 2026

Aplikace je nasazená na https://pinaprosek.eu. Bankovní párování zatím není
rozhodnuté. Export plateb, platební brána ani přehled oznámení nejsou v plánu.

---

## 1. O co jde

**Pína** je týmová kasa za prohřešky. Přijdeš pozdě na trénink, zapomeneš dres,
zkazíš podání — zaplatíš pár korun do společné kasy. Na konci sezóny se z kasy
udělá týmová akce. Není to trest, je to legrace, která zároveň drží tým v pohybu.

Dneska to většina týmů řeší v sešitě, v Excelu nebo v hlavě jednoho člověka.
Vždycky se u toho stejně dohaduje, kdo co dluží.

Aplikaci jsem napsal v roce 2023 jako ročníkový projekt. Fungovala, používalo ji
několik týmů — ale byla ošklivá, uměla jenom prohřešky a mobilní verze mezitím
přestala existovat (přišel jsem o účet ve vývojářském portálu Googlu).

Nová aplikace už funguje v prohlížeči a dá se přidat na plochu telefonu.
K prohřeškům přibyly **docházka, nominace, cesťáky a evidence plateb**.
Historie staré aplikace byla převedena; stará hesla se nepřenášela.
Další úpravy vycházejí ze zpětné vazby týmů při používání.

---

## 2. Kdo aplikaci používá

Aplikace počítá s **třemi rolemi v týmu**. Jeden člověk může mít v různých týmech
různou roli (hráč u mužů, pínař u juniorů).

### Hráč
Většina lidí. Nezapisuje nic, jen sleduje a odpovídá.
- Vidí, kolik dluží a za co konkrétně.
- Vidí přehled celého týmu — kdo je největší hříšník.
- Vidí kalendář tréninků a zápasů: kdy, kde, čas srazu, adresa s prokliknutím do navigace.
- Zaklikne, jestli na akci dorazí, a jestli jede autem.
- Vidí **svoje** procento účasti (cizí ne).

### Pínař (ten, co zapisuje)
Nejaktivnější uživatel. Sedí v šatně nebo v hospodě a zapisuje.
- Zapisuje prohřešky — rychle, hromadně, ideálně na pár klepnutí.
- Může zápis stornovat, když se splete.
- Opravuje docházku, když se liší od toho, co si hráči naklikali.
- Označuje, kdo už zaplatil.
- Vidí, kolik je v kase a kdo dluží nejvíc.

### Admin týmu
Většinou trenér, kapitán nebo zakladatel týmu. Role trenéra se nezavádí zvlášť —
v praxi je to tentýž člověk.
- Umí všechno, co pínař, a navíc:
- Zve nové hráče a přiděluje jim role.
- Vytváří sezóny a zavírá je.
- Nastavuje sazebník — jaké prohřešky existují a kolik stojí.
- Zakládá tréninky a zápasy, včetně opakovaných ("každé úterý a čtvrtek v 19:00").
- Sestavuje nominace na zápasy.
- Jako jediný vidí **procenta účasti a žebříčky docházky**.
- Nastavuje pravidla týmu — sazbu za kilometr, zúčtovací období, viditelnost dat.

---

## 3. Prohřešky — jádro aplikace

### Sazebník
Každý tým má vlastní seznam prohřešků a jejich cen — a vlastní na každou sezónu,
protože ceny se mění. Například:

| Prohřešek | Částka |
|---|---|
| Pozdní příchod na trénink | 20 Kč |
| Neomluvená absence | 100 Kč |
| Zapomenutý dres | 50 Kč |
| Eso po týmu (soupeř dá servis na zem) | 20 Kč |
| Hlava (míč do hlavy) | 20 Kč |
| Nepřipravenost na trénink | 30 Kč |

Prohřešky mají pořadí, aby ty nejčastější byly při zapisování první. Kategorie
(disciplína / herní / srandovní) budou volitelné — na funkčnost je potřeba nejsou,
ale pínaři usnadní hledání v dlouhém seznamu.

**Sazebník umí i záporné částky** — bonusy. „MVP extraligy" −20, „Eso po týmu" −20,
„Vánoce" −200. Odečítají se z dluhu a v přehledech budou barevně odlišené od pokut.

### Zapisování
Pínař vybere trénink, zápas nebo turnaj a projde tým: u koho co a kolikrát.

**Než se cokoli odešle, ukáže se souhrn.** Přehledná obrazovka, kde je vidět:
- o jakou akci a datum jde a **kolik to dělá celkem**,
- po jednotlivých hráčích: co komu přibylo, za kolik, a **kolik bude dlužit potom**,
- upozornění na podezřelé věci — někdo má výrazně víc než ostatní, někdo dostal
  prohřešek, i když na tréninku vůbec nebyl, nebo je něco zapsané dvakrát,
- z každé položky se dá jedním klepnutím vrátit a opravit to.

Teprve pak se to odešle. Zapisuje se cizí dluh, takže „ups, odesláno omylem"
je věc, kterou aplikace nesmí umožnit jen tak.

Rozepsaný zápis se průběžně ukládá — když se vybije telefon nebo se omylem zavře
prohlížeč, pínař o práci nepřijde. A celá dávka se dá jedním klepnutím stornovat.

### Oznámení hráčům
Po odeslání dostane každý dotčený hráč zprávu do telefonu:

> **Nový zápis do píny**
> V píně máš nový zápis.

Částky ani jména se na zamčené obrazovce neukazují; rozpis je v aplikaci.
Důležité: **jedna zpráva za celou dávku**,
ne pět zpráv během deseti vteřin — to je nejrychlejší způsob, jak lidi přimět
notifikace vypnout. Storno je vidět v přehledu zápisů.

Každý si zapíná push oznámení podle svého. E-mailová náhrada ani samostatný
seznam oznámení nejsou součástí aplikace. Zápisy zůstávají dostupné v přehledech.

**Novinky proti staré verzi:**
- **Zápis se dá stornovat**, ne jen smazat — je vidět, že existoval a kdo ho zrušil.
  (Kolem peněz se v týmu vždycky hádá a "ono se to samo smazalo" je špatná odpověď.)
- **Cena se u zápisu zamrazí.** Ve staré verzi platilo, že když admin zdražil
  prohřešek, přepsala se tím i historie a lidem se zpětně změnily dluhy.
- **Prohřešek se dá navázat na konkrétní akci** — "pozdní příchod na trénink 12. 9."

### Nová sezóna jedním průvodcem
Když sezóna skončí, nechceš zakládat všechno znovu. Průvodce převezme z minulé sezóny:

- **sazebník** — zaškrtneš, co zůstává, a rovnou upravíš ceny,
- **soupisku** — u každého hráče zaškrtávací pole „pokračuje / končí",
- **pravidelné tréninky** (úterý a čtvrtek v 19:00).

**Zapsané prohřešky se nepřenášejí** — nová sezóna začíná všem na nule. Kdo v týmu
skončil, zůstane v historii, jen už není na soupisce.

### Přehledy
- Moje prohřešky: co, kdy, za kolik, kolik celkem dlužím.
- Tabulka celého týmu: řádky hráči, sloupce prohřešky, součet.
- Grafy: podíl jednotlivých prohřešků v týmu, můj podíl vs. zbytek týmu.
- Žebříček — kdo vede v počtu i v částce. (Motivační, nebo spíš nepříjemné?)
- Export do Excelu / CSV pro toho, kdo si to chce vzít bokem.

---

## 4. Docházka a nominace — hlavní novinka

Tohle stará aplikace neuměla vůbec a je to důvod, proč se do toho pouštím znovu.

### Akce (tréninky, zápasy, ostatní)
Akce má:
- **typ** — trénink / zápas / jiné (soustředění, brigáda, týmová akce),
- **datum a čas** začátku a konce,
- **čas srazu** zvlášť — u zápasů se sraz často liší od začátku,
- **místo** s adresou a **prokliknutím do navigace** (Mapy Google, Waze, Apple Maps),
- **poznámku** — "vchod ze dvora", "vezměte světlé i tmavé dresy", "startovné 100 Kč",
- u zápasu **soupeře**.

### Opakované akce
Trénink každé úterý a čtvrtek v 19:00 se zadá **jednou** a aplikace vygeneruje
všechny termíny v sezóně. Jednotlivý termín se dá zrušit (hala je obsazená)
nebo přesunout, aniž by se rozbila celá série.

### Kdo přijde: hráči si klikají sami
Ke každé akci hráč zaklikne **jdu / nejdu**, případně s poznámkou („dorazím
o 20 minut později"). Trenér tak předem vidí, s kým počítat, místo dohledávání
ve skupinovém chatu.

**Nominace jen u zápasů.** Admin označí, kdo je nominovaný a kdo náhradník.
U tréninků se nenominuje — bylo by to zbytečné papírování.

### Docházka se nezapisuje, jen opravuje
Tohle je hlavní změna oproti prvnímu návrhu. Původně to bylo tak, že po každém
tréninku někdo proklikává celý tým a zaznamenává, kdo dorazil. To by nikdo nedělal.

Místo toho **se docházka vezme z toho, co si hráči naklikali předem**:

```
hráč zaklikne "jdu"      →  počítá se jako přítomen
hráč zaklikne "nejdu"    →  počítá se jako nepřítomen
hráč neklikne nic        →  počítá se jako nepřítomen
```

Po akci pak trenér nebo pínař **přepíše jen výjimky** — někdo dorazil, i když
psal, že nemůže. Většinou nebude potřeba dělat vůbec nic.

**Absence se nerozlišuje** na omluvenou a neomluvenou — absence je absence.
Jediná výjimka je **zranění nebo dlouhodobá nemoc**, kterou lze zakliknout zvlášť
a do procenta účasti se vůbec nepočítá. Nemá smysl, aby někomu klesala statistika
kvůli natrženému kotníku.

### Kdo co vidí

| | Hráč | Pínař | Admin |
|---|:--:|:--:|:--:|
| Dluhy ostatních | podle nastavení týmu | ✓ | ✓ |
| Vlastní docházka | ✓ | ✓ | ✓ |
| Docházka ostatních | podle nastavení týmu | ✓ | ✓ |
| Procenta účasti a žebříčky | vlastní; ostatní podle nastavení | ✓ | ✓ |

Výchozí nastavení zpřístupňuje dluhy spoluhráčů a skrývá jejich výslednou
docházku. Admin může obě volby změnit. Odpovědi na budoucí akce jsou vidět
kvůli domluvě účasti a odvozů.

---

## 5. Peníze

### Co aplikace umí v základu
- Spočítá, **kdo kolik dluží** z prohřešků, bonusů, plateb a cesťáků.
- Pínař označí přijatou platbu (hotovost nebo převod).
- Ukáže, **kolik je v kase** a kolik ještě chybí vybrat.

### Cesťáky a členění na pololetí
Zjistilo se, že tým mužů si proplácení cest eviduje tak, že si do sazebníku založí
položku „Cesťák 1.pol Vénis" se zápornou částkou. Aplikace to totiž neuměla.

Současná pravidla:

- U zápasu venku hráč zaklikne, že **jede autem** (a kolik má volných míst —
  poslouží to zároveň k domluvě odvozů).
- Aplikace zná vzdálenost od domácí haly k hale soupeře a **sazbu za kilometr**,
  kterou si tým nastaví sám. Počítá se cesta tam i zpět.
- Náhradu dostane **jen řidič**. Spolujezdci nic — jestli se mu složí na benzín,
  je věc dohody v autě, ne aplikace.
- Platí to **jen pro zápasy**, u tréninků žádný nárok nevzniká.

Přehled lze rozdělit na **pololetí podle data v sezóně**. Nejde o uzávěrku:
pozdější zápisy lze doplnit a nic se kvůli pololetí nezamyká. Platba patří
do pololetí, kdy přišla, a QR vyzývá k celému zbývajícímu dluhu sezóny.
Celou sezónu může uzavřít admin; tím se další zápisy zamknou.

Z píny se tím stává **obousměrná pokladna** — dosud uměla jen vybírat.

Obojí je **volitelné a nastavuje se pro každý tým zvlášť**. Mládežnické družstvo,
které cesťáky neřeší, o tom nemusí vůbec vědět.

### QR platba
U svého dluhu si hráč zobrazí **QR kód**, naskenuje ho v bankovní aplikaci
a částka i variabilní symbol se předvyplní. Zaplatí na dvě klepnutí, nic se
nepřepisuje ručně. Nestojí to nic a nevyžaduje to žádnou smlouvu.

### Automatické párování plateb (nerozhodnuto)
Napojení na banku, aby aplikace sama viděla příchozí platby a označila je jako
uhrazené. Pínař by pak neřešil nic — jen občas ručně přiřadil platbu bez
variabilního symbolu.

O realizaci ani termínu není rozhodnuto. Bez párování je platební koloběh kompletní:
hráč zaplatí přes QR a pínař přijatou platbu zapíše. Databázové podklady pro případné
párování zatím zůstávají.

### Platební brána
Platby kartou nejsou v aktuálním rozsahu. Aplikace používá QR a ručně potvrzené
platby; rezervy pro platební bránu byly z kódu a schématu odstraněny.

**Výdaje z kasy** (co se za peníze nakoupilo) aplikace evidovat nebude — na to není
týmová pína byznys. Jedinou výjimkou jsou cesťáky, které se proplácejí hráčům
a jsou tedy součástí zúčtování.

---

## 6. Jak se aplikace používá

- **V prohlížeči na počítači i na telefonu.** Žádné stahování z obchodu.
- Na telefonu si aplikaci **přidáš na plochu** a chová se pak jako běžná aplikace —
  vlastní ikona a celá obrazovka. Pro načítání dat a zápisy je potřeba připojení.
- **Upozornění na telefon**: zapsané prohřešky (jedna zpráva za dávku) a připomínka
  nezodpovězené akce. Každou kategorii si hráč zapíná sám.
- **Pozvánky e-mailem**: admin zadá e-mail, hráči přijde odkaz, nastaví si heslo, hotovo.
- Aplikaci může používat **víc klubů najednou**, každý vidí jen svoje data.
- Aplikace je česky a přizpůsobená ovládání na mobilu.
- **Režim podpory** umožňuje správci aplikace otevřít družstvo s právy admina,
  aniž by se přidal mezi jeho hráče. Účet je společný, členství a role jsou po družstvech.

---

## 7. Co se mění proti staré verzi

| | Stará (2023) | Nová |
|---|---|---|
| Vzhled | funkční, ale ošklivá | navržený design, světlý i tmavý režim, mobile-first |
| Mobil | Android aplikace (dnes nedostupná) | webová aplikace na ploše telefonu, i na iPhonu |
| Role | admin / hráč | **admin / pínař / hráč**, různé v každém týmu |
| Prohřešky | ano | ano, plus **souhrn před odesláním**, storno celé dávky, zamrazená cena, vazba na akci |
| Docházka | — | **odvozená z toho, co si hráči naklikali; opravují se jen výjimky** |
| Nominace | — | **na zápasy, s odpověďmi hráčů** |
| Statistiky účasti | — | **pínař a admin; hráči podle nastavení týmu** |
| Cesťáky | řešeno záporným prohřeškem pro každého hráče | **sazba za km, „jedu autem", automatický výpočet** |
| Zúčtování | ručně mimo aplikaci | **průběžný zůstatek a členění na pololetí bez uzávěrky** |
| Peníze | jen součet dluhu | QR platba a ručně potvrzené úhrady |
| Upozornění | pop-up v aplikaci | push do telefonu, agregované, s vlastním nastavením |
| Bezpečnost | slabá (viz technická analýza) | přepsáno od základu |
| Historie dat | — | **historie převedena** (6 000+ zápisů, 6 sezón, 4 týmy) |

---

## 8. Zpětná vazba z týmu — co se změnilo

Kolo připomínek proběhlo 16. 8. 2026 a promítlo se do návrhu takto:

| Připomínka | Jak je zapracovaná |
|---|---|
| „Zaklikávat po každém tréninku bude strašný oser" | Docházka se bere z toho, co si hráči naklikali předem; opravují se jen výjimky |
| „Absence je absence" | Omluvená/neomluvená se nerozlišuje, zvlášť je jen zranění a dlouhodobá nemoc |
| „Docházku vidět jen svoji, 100 %!" | Výchozí stav: hráč vidí sebe, celý tým pínař a admin; lze upravit nastavením |
| „Dluhy ostatních klidně, to je prdel" | Výchozí stav je viditelnost všem, admin ji může omezit |
| „Nominace na tréninky je zbytečná" | Nominuje se jen na zápasy |
| „Role admin a trenér jsou vicemene totožné" | Zůstávají tři role, žádná se nepřidává |
| „Kategorie prohřešků jsou jen zpřehlednění" | Volitelné, ne povinné |
| „Výdaje z kasy jsou zbytečné" | Vypuštěno |
| „Změnu docházky umožnit i pínaři" | Smí admin i pínař |
| „Nešlo by něco s cesťáky? Zakliknout, že mám auto?" | Nová funkce — viz kapitola 5, včetně sazby za kilometr |
| „Týdenní přehled není důležitý, rýpání nevadí" | Oznámení chodí hned, souhrn se neřeší |

Pozdější rozhodnutí: pololetí slouží pouze k členění. Přehled oznámení ani
export plateb tým nepotřebuje. Bankovní párování zatím nemá rozhodnutý termín ani rozsah.

## 9. Na co ještě potřebuju názor

Cesťáky jsou dořešené, pravidla vypadají takto:

| | |
|---|---|
| Kilometry | vzdálenost od domácí haly k hale soupeře, počítá se cesta tam i zpět |
| Kdo dostane náhradu | **jen řidič**; spolujezdci nic |
| Kdy vzniká | **pouze u zápasů**, ne u tréninků |
| Kdo uzavírá sezónu | **admin**; pololetí se neuzavírá |
| Bonusy | zůstávají v jednom seznamu s pokutami, jen barevně odlišené |

Tým si nastaví svou **domácí halu** a **sazbu za kilometr**, zbytek už aplikace
spočítá sama z toho, kdo u zápasu zaklikl „jedu autem".

Zbývá jediné, a to se stejně nejlíp ukáže až v provozu: jestli má řidič moct
předvyplněnou vzdálenost ručně upravit, když jede oklikou pro spoluhráče.

---

## 10. Co není v aktuálním rozsahu

- Platby kartou přes platební bránu.
- Přehled oznámení v aplikaci a export plateb.
- Statistiky ze zápasů (body, úspěšnost podání).
- Chat a diskuze v týmu.
- Veřejný profil klubu a výsledkový servis.

Bankovní párování je nerozhodnutá možnost do budoucna, na které ostatní funkce
nezávisí. Hlavní rozsah aplikace je dokončený; další změny vycházejí z používání.
