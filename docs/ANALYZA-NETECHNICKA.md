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
prohřešků bude aplikace umět i **docházku, nominace na tréninky a zápasy a evidenci
plateb**. Poběží v prohlížeči a půjde si ji přidat na plochu telefonu jako běžnou
aplikaci — bez stahování z obchodu.

**Všechna data se přenesou.** Aplikace za tři a půl roku nasbírala přes 6 000 zápisů
ve čtyřech týmech a šesti sezónách — historie zůstane zachovaná včetně správných
cen, které se mezi sezónami měnily. Jediné, co se nepřenáší, jsou hesla: každý
dostane pozvánku a nastaví si nové.

**Od tebe potřebuju hlavně jedno:** projít níže uvedený seznam funkcí a říct,
co je zbytečné, co chybí a co bys jako hráč/trenér/pínař reálně používal.
Otázky k zamyšlení jsou v kapitole 8.

---

## 2. Kdo aplikaci používá

Aplikace počítá s **třemi rolemi v týmu**. Jeden člověk může mít v různých týmech
různou roli (hráč u mužů, pínař u juniorů).

### Hráč
Většina lidí. Nezapisuje nic, jen sleduje a odpovídá.
- Vidí, kolik dluží a za co konkrétně.
- Vidí přehled celého týmu — kdo je největší hříšník.
- Vidí kalendář tréninků a zápasů: kdy, kde, čas srazu, adresa s prokliknutím do navigace.
- Dostane nominaci a odpoví, jestli dorazí.
- Vidí svoje procento účasti.

### Pínař (ten, co zapisuje)
Nejaktivnější uživatel. Sedí v šatně nebo v hospodě a zapisuje.
- Zapisuje prohřešky — rychle, hromadně, ideálně na pár klepnutí.
- Může zápis stornovat, když se splete.
- Zapisuje docházku po tréninku (kdo dorazil, kdo se omluvil, kdo ne).
- Označuje, kdo už zaplatil.
- Vidí, kolik je v kase a kdo dluží nejvíc.

### Admin týmu
Většinou trenér, kapitán nebo zakladatel týmu.
- Umí všechno, co pínař, a navíc:
- Zve nové hráče a přiděluje jim role.
- Vytváří sezóny a zavírá je.
- Nastavuje sazebník — jaké prohřešky existují a kolik stojí.
- Zakládá tréninky a zápasy, včetně opakovaných ("každé úterý a čtvrtek v 19:00").
- Sestavuje nominace.
- Nastavuje pravidla týmu (např. jestli hráči vidí dluhy ostatních).

> **Otázka k diskuzi:** stačí tyhle tři role? Nechybí například role *trenér*,
> který sestavuje nominace a zapisuje docházku, ale nemá co dělat s penězi?

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

Prohřešky mají pořadí, aby ty nejčastější byly při zapisování první.
Mohly by mít i kategorie (disciplína / herní / srandovní) — má to smysl?

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

### Nominace
Admin (nebo trenér) označí, kdo je na akci nominovaný a kdo je náhradník.
Nominovat se dá i na trénink, ne jen na zápas.

Hráč dostane upozornění a odpoví: **jdu / nejdu / ještě nevím**, s možností
poznámky ("dorazím o 20 minut později", "mám zkoušku, dám vědět v pondělí").

Trenér tak před akcí vidí, s kým počítat — místo dohledávání ve skupinovém chatu.

### Docházka
Po akci pínař nebo trenér zaklikne, jak to dopadlo:
**byl / omluven / neomluven / přišel pozdě**.

Z toho vzniká:
- **procento účasti každého hráče** za sezónu,
- žebříček docházky,
- podklad pro to, kdo si zaslouží místo v sestavě.

### Propojení docházky s pínou
Neomluvená absence může být automaticky **navržena** jako prohřešek — pínař ji
jen potvrdí. Záměrně jen návrh, ne automatický zápis: peníze bez lidské kontroly
jsou v týmu zdroj konfliktů.

> **Otázky:**
> - Má se do procenta účasti počítat omluvená absence, nebo se má ignorovat?
> - Mají hráči vidět docházku ostatních, nebo jenom svoji?
> - Má smysl "potvrzení na místě" — hráč si v hale sám odklikne, že dorazil?

---

## 5. Peníze

### Co aplikace umí v základu
- Spočítá, **kdo kolik dluží** (prohřešky mínus zaplaceno).
- Pínař označí přijatou platbu (hotovost nebo převod).
- Ukáže, **kolik je v kase** a kolik ještě chybí vybrat.
- Pošle upomínku dlužníkům.

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

> **Otázky:**
> - Vybírá se u vás pína průběžně, nebo jednorázově na konci sezóny?
> - Vyplatí se evidovat i **výdaje** z kasy (co se za peníze koupilo)?
>   Byla by z toho úplná pokladní kniha týmu.
> - Má hráč vidět, kolik je celkem v kase, nebo je to věc pínaře?

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
| Docházka | — | **tréninky, zápasy, opakované akce, místa, navigace** |
| Nominace | — | **nominace + odpovědi hráčů** |
| Statistiky účasti | — | **procenta účasti, žebříčky** |
| Peníze | jen součet dluhu | QR platba, evidence úhrad, upomínky, později napojení na banku |
| Upozornění | pop-up v aplikaci | push do telefonu + e-mail, agregované, s vlastním nastavením |
| Bezpečnost | slabá (viz technická analýza) | přepsáno od základu |
| Historie dat | — | **všechna stará data se přenesou** (6 000+ zápisů, 6 sezón, 4 týmy) |

---

## 8. Na co potřebuju tvůj názor

1. **Role** — stačí admin / pínař / hráč? Chybí trenér?
2. **Nominace na tréninky** — používali byste to, nebo je to zbytečná byrokracie
   a stačí u zápasů?
3. **Docházka** — kdo ji má zapisovat? A má si ji hráč moct odkliknout sám?
4. **Veřejnost dat** — mají hráči vidět dluhy a docházku ostatních, nebo jen svoje?
5. **Pokladní kniha** — má aplikace evidovat i výdaje z kasy?
6. **Oznámení o prohřešcích** — chce je člověk dostat hned po tréninku, nebo je
   příjemnější souhrn jednou týdně? A má u zprávy být rovnou vidět celkový dluh,
   nebo je to zbytečné rýpání?
7. **Co v seznamu chybí?** Napadá tě funkce, kvůli které bys aplikaci otevíral
   častěji? (Statistiky ze zápasů? Rozdělování odvozů na venkovní zápasy?
   Hlasování o termínu týmové akce? Střídání praní dresů?)
8. **Co je naopak zbytečné?** Radši méně funkcí, které lidi opravdu používají,
   než dvacet záložek, ve kterých se nikdo nevyzná.
9. **Znáš tým, který by to zkusil?** Aplikace bude od začátku pro víc klubů,
   takže reálné testování mimo Prosek by hodně pomohlo.

---

## 9. Co v první verzi vědomě nebude

Aby se to vůbec dodělalo, nechávám stranou:
- platby kartou přes platební bránu,
- statistiky ze zápasů (body, úspěšnost podání) — to je jiná aplikace,
- chat a diskuze v týmu — na to má každý tým WhatsApp a nemá cenu s tím soupeřit,
- veřejný profil klubu, výsledkový servis,
- rozdělování odvozů a spolujízdy (možná později, jako doplněk k akcím).

- napojení na banku a automatické párování plateb (samostatná věc na později).

Pořadí prací: nejdřív **přihlášení a správa týmu**, pak **prohřešky** (aby se
mohla vypnout stará aplikace), pak **docházka a nominace**, pak **peníze a QR**
a nakonec **upozornění na telefon**. Tím je aplikace hotová. Napojení na banku
je až následný přírůstek, na kterém nic z toho nestojí.
