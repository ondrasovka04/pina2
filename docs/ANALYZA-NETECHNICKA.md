# Pína 2.0 — Co by aplikace měla umět

**Dokument pro diskuzi o funkcích. Bez technických detailů.**
Datum: 14. 8. 2026

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

**Teď to píšu celé znovu od nuly** — nový vzhled, nové funkce a hlavně: kromě
prohřešků bude aplikace umět i **docházku, nominace na zápasy, cesťáky a evidenci
plateb**. Poběží v prohlížeči a půjde si ji přidat na plochu telefonu jako běžnou
aplikaci — bez stahování z obchodu.

**Všechna data se přenesou.** Aplikace za tři a půl roku nasbírala přes 6 000 zápisů
ve čtyřech týmech a šesti sezónách — historie zůstane zachovaná včetně správných
cen, které se mezi sezónami měnily. Jediné, co se nepřenáší, jsou hesla: každý
dostane pozvánku a nastaví si nové.

**Dokument je po prvním kole připomínek z týmu** (16. 8. 2026) — co se na jejich
základě změnilo, shrnuje kapitola 8. Otevřené otázky jsou v kapitole 9.

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

> **Pína — trénink 16. 9.**
> Byly ti zapsány 3 prohřešky za 60 Kč. Celkem dlužíš 340 Kč.

Klepnutím se otevře rozpis, za co to bylo. Důležité: **jedna zpráva za celou dávku**,
ne pět zpráv během deseti vteřin — to je nejrychlejší způsob, jak lidi přimět
notifikace vypnout. Když pínař dávku stornuje, přijde i oprava.

Kdo nechce notifikace do telefonu, dostane e-mail; kdo nechce ani to, uvidí vše
v aplikaci v seznamu oznámení. Každý si sám nastaví, co chce dostávat.

**Novinky proti staré verzi:**
- **Zápis se dá stornovat**, ne jen smazat — je vidět, že existoval a kdo ho zrušil.
  (Kolem peněz se v týmu vždycky hádá a "ono se to samo smazalo" je špatná odpověď.)
- **Cena se u zápisu zamrazí.** Ve staré verzi platilo, že když admin zdražil
  prohřešek, přepsala se tím i historie a lidem se zpětně změnily dluhy.
- **Prohřešek se dá navázat na konkrétní akci** — "pozdní příchod na trénink 12. 9."

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
| Dluhy ostatních | ✓ | ✓ | ✓ |
| Vlastní docházka | ✓ | ✓ | ✓ |
| Docházka ostatních | — | ✓ | ✓ |
| Procenta účasti a žebříčky | — | — | ✓ |

Dluhy jsou veřejné, protože jsou legrace. Docházka ne — je to citlivější věc
a hráči by z ní neměli dělat závody.

---

## 5. Peníze

### Co aplikace umí v základu
- Spočítá, **kdo kolik dluží** (prohřešky mínus zaplaceno).
- Pínař označí přijatou platbu (hotovost nebo převod).
- Ukáže, **kolik je v kase** a kolik ještě chybí vybrat.
- Pošle upomínku dlužníkům.

### Cesťáky a půlroční zúčtování
Zjistilo se, že tým mužů si proplácení cest eviduje tak, že si do sazebníku založí
položku „Cesťák 1.pol Vénis" se zápornou částkou. Aplikace to totiž neuměla.

Nově to bude pořádně:

- U zápasu venku hráč zaklikne, že **jede autem** (a kolik má volných míst —
  poslouží to zároveň k domluvě odvozů).
- Aplikace zná vzdálenost a **sazbu za kilometr**, kterou si tým nastaví sám.
- Z toho spočítá, kolik komu tým dluží.

Na konci období — typicky **po půlce sezóny**, jak to děláte teď — se udělá
**zúčtování**: sečtou se prohřešky, bonusy, cesťáky i zaplacené částky a vyjde
jediné číslo. Kdo je v mínusu, doplácí; komu tým dluží za odvozy, tomu se to proplatí.

Z píny se tím stává **obousměrná pokladna** — dosud uměla jen vybírat.

Obojí je **volitelné a nastavuje se pro každý tým zvlášť**. Mládežnické družstvo,
které cesťáky neřeší, o tom nemusí vůbec vědět.

### QR platba
U svého dluhu si hráč zobrazí **QR kód**, naskenuje ho v bankovní aplikaci
a částka i variabilní symbol se předvyplní. Zaplatí na dvě klepnutí, nic se
nepřepisuje ručně. Nestojí to nic a nevyžaduje to žádnou smlouvu.

### Automatické párování plateb (až později, není součástí plánu)
Napojení na banku, aby aplikace sama viděla příchozí platby a označila je jako
uhrazené. Pínař by pak neřešil nic — jen občas ručně přiřadil platbu bez
variabilního symbolu.

**Tohle vědomě odkládám na později.** Bez toho je platební koloběh kompletní:
hráč zaplatí přes QR, pínař platbu odklikne. Automatické párování jen ušetří
to jedno klepnutí. Chtěl bych z něj udělat **diplomovou práci**, a to je o důvod
víc, proč s ním nespěchat — až se k tomu dostanu, poběží aplikace s reálnými daty.

### Platební brána?
Zvažoval jsem platbu kartou přímo v aplikaci. Technicky je to hotové řešení, ale:
u píny 20–50 Kč jsou poplatky brány proporčně vysoké, vyžaduje to smlouvu
a ověření a přibude účetnictví. **QR platba plus napojení na banku dělá to samé
za nula korun.** Brána zůstává jako možnost do budoucna.

**Výdaje z kasy** (co se za peníze nakoupilo) aplikace evidovat nebude — na to není
týmová pína byznys. Jedinou výjimkou jsou cesťáky, které se proplácejí hráčům
a jsou tedy součástí zúčtování.

---

## 6. Jak se to bude používat

- **V prohlížeči na počítači i na telefonu.** Žádné stahování z obchodu.
- Na telefonu si aplikaci **přidáš na plochu** a chová se pak jako běžná aplikace —
  vlastní ikona, na celou obrazovku, funguje i při slabém signálu.
- **Upozornění na telefon**: zapsané prohřešky (jedna souhrnná zpráva za akci),
  nová nominace, připomínka akce den předem a dvě hodiny předem, potvrzení přijaté
  platby, měsíční upomínka dluhu. Každý si může vybrat, co chce dostávat.
- **Pozvánky e-mailem**: admin zadá e-mail, hráči přijde odkaz, nastaví si heslo, hotovo.
- Aplikaci může používat **víc klubů najednou**, každý vidí jen svoje data.
- Bude to česky, s ohledem na to, že se používá v šatně na mobilu jednou rukou.

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
| Statistiky účasti | — | **procenta a žebříčky — vidí je jen admin** |
| Cesťáky | řešeno záporným prohřeškem pro každého hráče | **sazba za km, „jedu autem", automatický výpočet** |
| Zúčtování | ručně mimo aplikaci | **půlroční uzávěrka: prohřešky − bonusy − cesťáky − platby** |
| Peníze | jen součet dluhu | QR platba, evidence úhrad, upomínky, později napojení na banku |
| Upozornění | pop-up v aplikaci | push do telefonu + e-mail, agregované, s vlastním nastavením |
| Bezpečnost | slabá (viz technická analýza) | přepsáno od základu |
| Historie dat | — | **všechna stará data se přenesou** (6 000+ zápisů, 6 sezón, 4 týmy) |

---

## 8. Zpětná vazba z týmu — co se změnilo

Kolo připomínek proběhlo 16. 8. 2026 a promítlo se do návrhu takto:

| Připomínka | Jak je zapracovaná |
|---|---|
| „Zaklikávat po každém tréninku bude strašný oser" | Docházka se bere z toho, co si hráči naklikali předem; opravují se jen výjimky |
| „Absence je absence" | Omluvená/neomluvená se nerozlišuje, zvlášť je jen zranění a dlouhodobá nemoc |
| „Docházku vidět jen svoji, 100 %!" | Hráč vidí jen sebe, procenta a žebříčky vidí pouze admin |
| „Dluhy ostatních klidně, to je prdel" | Zůstávají viditelné všem |
| „Nominace na tréninky je zbytečná" | Nominuje se jen na zápasy |
| „Role admin a trenér jsou vicemene totožné" | Zůstávají tři role, žádná se nepřidává |
| „Kategorie prohřešků jsou jen zpřehlednění" | Volitelné, ne povinné |
| „Výdaje z kasy jsou zbytečné" | Vypuštěno |
| „Změnu docházky umožnit i pínaři" | Smí admin i pínař |
| „Nešlo by něco s cesťáky? Zakliknout, že mám auto?" | Nová funkce — viz kapitola 5, včetně sazby za kilometr |
| „Týdenní přehled není důležitý, rýpání nevadí" | Oznámení chodí hned, souhrn se neřeší |

Otevřené k ověření v provozu: půlroční zúčtování jako volitelná funkce týmu
a to, jestli se ke zkoušení přidá MFF nebo Modřany.

## 9. Na co ještě potřebuju názor

Zbývá dořešit hlavně kolem cesťáků, protože tam je nejvíc variant:

1. **Kdo zadává kilometry?** Aplikace může znát vzdálenost k hale a předvyplnit ji,
   ale někdo jede oklikou pro spoluhráče. Má řidič vzdálenost upravovat, nebo se
   drží pevná sazba za zápas?
2. **Počítá se náhrada na auto, nebo na hráče?** Když jedou tři lidi jedním autem,
   dostane náhradu jen řidič (a spolujezdci se mu skládají), nebo se to dělí?
3. **Platí to samé pro tréninky?** Nebo jen pro zápasy venku?
4. **Kdy se zúčtování uzavírá** a kdo ho spouští — admin, nebo pínař?
5. **Bonusy** („MVP extraligy", „Vánoce −200") — mají zůstat v jednom seznamu
   s pokutami, nebo mít vlastní záložku?

---

## 10. Co v první verzi vědomě nebude

Aby se to vůbec dodělalo, nechávám stranou:
- platby kartou přes platební bránu,
- statistiky ze zápasů (body, úspěšnost podání) — to je jiná aplikace,
- chat a diskuze v týmu — na to má každý tým WhatsApp a nemá cenu s tím soupeřit,
- veřejný profil klubu, výsledkový servis,
- statistiky ze zápasů (body, úspěšnost podání),

- napojení na banku a automatické párování plateb (samostatná věc na později).

Pořadí prací: nejdřív **přihlášení a správa týmu**, pak **prohřešky** (aby se
mohla vypnout stará aplikace), pak **docházka a nominace**, pak **peníze a QR**
a nakonec **upozornění na telefon**. Tím je aplikace hotová. Napojení na banku
je až následný přírůstek, na kterém nic z toho nestojí.
