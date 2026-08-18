-- Ucet a znak z klubu na druzstvo.
--
-- Ucet se do teto chvile ukladal na klub, ale editoval se v nastaveni druzstva:
-- zmena u muzu tim tise prepsala ucet juniorum i kadetum. Kazde druzstvo ma
-- vlastni kasu, takze cislo uctu patri k nemu.
--
-- Pro koho to je: pro databazi, ktera uz v novem schematu bezi (vyvojova).
-- Nove zalozena ji nepotrebuje -- 001_init.sql ma oba sloupce rovnou na miste
-- a tools/migrate_legacy.php ucet ani znak neprenasi, ty se zadavaji rucne.

ALTER TABLE team ADD COLUMN logo_url VARCHAR(255) NULL
  COMMENT 'nahrany znak druzstva; bez nej se kresli znak klubu' AFTER color;

ALTER TABLE team_settings ADD COLUMN bank_account VARCHAR(50) NULL
  COMMENT 'pro QR platby (IBAN nebo cislo uctu)' AFTER team_id;

-- Ucet zdedi kazde druzstvo klubu. Retezec se muze klidne opakovat, takze se
-- nic neztrati a QR plati dal; kdo chce vlastni ucet, prepise si ho v nastaveni.
--
-- Musi to byt INSERT, ne UPDATE: druzstvo, kteremu nastaveni nikdo nikdy neulozil,
-- v team_settings zadny radek nema (aplikace pro ne cte vychozi hodnoty pres LEFT
-- JOIN). Samotny UPDATE by ho preskocil a takove druzstvo by o zdedeny ucet prislo
-- -- prestalo by mu fungovat QR. Zaklada se s temi samymi vychozimi hodnotami,
-- jake do teto chvile vracelo cteni, takze se tim nic jineho nemeni.
INSERT INTO team_settings (team_id, bank_account)
SELECT t.id, c.bank_account
  FROM team t
  JOIN club c ON c.id = t.club_id
 WHERE c.bank_account IS NOT NULL
ON DUPLICATE KEY UPDATE bank_account = VALUES(bank_account);

-- Znak se zamerne NEdedi. Cesta k souboru se kopirovat nesmi: vymena znaku
-- u jednoho druzstva maze stary soubor, ktery by ostatnim zustal v databazi jako
-- odkaz do prazdna. Kdo znak chce, nahraje si ho -- klubovy zustane jako vychozi.
-- Jen ucet. `club.logo_url` se v zadnem vydanem schematu neobjevil -- znak vznikl
-- rovnou na druzstvu, takze DROP by tady spadl na neexistujici sloupec.
ALTER TABLE club DROP COLUMN bank_account;

INSERT INTO schema_migration (version) VALUES ('002_ucet_a_znak_na_druzstvo');
