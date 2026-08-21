-- Pína 2.0 — schéma databáze
-- MySQL 8, InnoDB, utf8mb4_czech_ci
--
-- Jediný soubor, který popisuje schéma. Cílový tvar je tenhle, ne výsledek
-- řetězu migrací: `pina_test` se z něj staví před každým během testů
-- (`DatabaseTestCase`) a stejně se zakládá i produkce. Průběžné migrace
-- (účet a znak na družstvo, zrušení nečtených osobních údajů, `audit_log`
-- na družstvo) jsou zapracované sem a jejich soubory zrušené — dva popisy
-- téhož schématu se vždycky rozejdou. Historie změn je v gitu.
--
-- Na produkci to běží vedle starých tabulek (Uzivatel, Tym, ...), které
-- zůstávají nedotčené; jména se nekryjí.

SET NAMES utf8mb4;
SET time_zone = '+02:00';

-- ---------------------------------------------------------------- organizace

-- Klub drzi jen identitu. Ucet i znak patri druzstvu -- kazde ma vlastni kasu
-- a admin jednoho druzstva nema co menit nastaveni druhemu.
CREATE TABLE club (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name        VARCHAR(120) NOT NULL,
  slug        VARCHAR(60)  NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_club_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_czech_ci;

CREATE TABLE team (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  club_id     BIGINT UNSIGNED NOT NULL,
  name        VARCHAR(120) NOT NULL,
  color       VARCHAR(7) NULL,
  logo_url    VARCHAR(255) NULL COMMENT 'nahrany znak druzstva; bez nej se kresli znak klubu',
  archived_at DATETIME NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_team_club (club_id),
  CONSTRAINT fk_team_club FOREIGN KEY (club_id) REFERENCES club (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_czech_ci;

-- ---------------------------------------------------------------- lidé

CREATE TABLE `user` (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email             VARCHAR(190) NOT NULL,
  display_name      VARCHAR(120) NOT NULL,
  password_hash     VARCHAR(255) NULL COMMENT 'NULL = pozvany ucet, heslo si nastavi sam',
  avatar_url        VARCHAR(255) NULL,
  is_platform_admin TINYINT(1) NOT NULL DEFAULT 0,
  -- Vydane JWT nelze zneplatnit (server si je nepamatuje). Posunutim tohoto
  -- razitka na 'ted' se odmitnou vsechny drive vydane tokeny -- pouziva se pri
  -- zmene role, zmene hesla a pri "odhlasit vsude".
  tokens_valid_from DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  email_verified_at DATETIME NULL,
  created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  legacy_id         INT NULL COMMENT 'id ze stare tabulky Uzivatel, jen pro migraci',
  PRIMARY KEY (id),
  UNIQUE KEY uq_user_email (email),
  UNIQUE KEY uq_user_legacy (legacy_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_czech_ci;

-- Role je vazana na tym, ne globalne: hrac u muzu muze byt pinarem u junioru.
-- Hierarchie prav: admin > treasurer (pinar) > player.
CREATE TABLE membership (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id           BIGINT UNSIGNED NOT NULL,
  team_id           BIGINT UNSIGNED NOT NULL,
  role              ENUM('admin','treasurer','player') NOT NULL DEFAULT 'player',
  jersey_number     SMALLINT UNSIGNED NULL,
  payment_reference VARCHAR(10) NOT NULL COMMENT 'stabilni VS pro platby, generovan pri zalozeni',
  status            ENUM('active','left') NOT NULL DEFAULT 'active',
  joined_at         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  left_at           DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_membership (user_id, team_id),
  UNIQUE KEY uq_membership_vs (payment_reference),
  KEY ix_membership_team (team_id, status),
  CONSTRAINT fk_membership_user FOREIGN KEY (user_id) REFERENCES `user` (id) ON DELETE CASCADE,
  CONSTRAINT fk_membership_team FOREIGN KEY (team_id) REFERENCES team (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_czech_ci;

-- ---------------------------------------------------------------- sezóny

CREATE TABLE season (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  team_id      BIGINT UNSIGNED NOT NULL,
  name         VARCHAR(60) NOT NULL,
  starts_on    DATE NOT NULL,
  ends_on      DATE NOT NULL,
  half_year_on DATE NULL COMMENT 'prelom pololeti; NULL = pololeti se neresi. Jen hranice pro cleneni, nic se nezamyka',
  is_current   TINYINT(1) NOT NULL DEFAULT 0,
  closed_at    DATETIME NULL COMMENT 'uzavrena sezona je read-only',
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  legacy_key   VARCHAR(300) NULL COMMENT 'puvodni idSezona + idTym, jen pro migraci',
  PRIMARY KEY (id),
  UNIQUE KEY uq_season_name (team_id, name),
  UNIQUE KEY uq_season_legacy (legacy_key),
  KEY ix_season_team (team_id, starts_on),
  CONSTRAINT fk_season_team FOREIGN KEY (team_id) REFERENCES team (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_czech_ci;

CREATE TABLE roster_entry (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  season_id     BIGINT UNSIGNED NOT NULL,
  membership_id BIGINT UNSIGNED NOT NULL,
  active        TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_roster (season_id, membership_id),
  CONSTRAINT fk_roster_season FOREIGN KEY (season_id) REFERENCES season (id) ON DELETE CASCADE,
  CONSTRAINT fk_roster_membership FOREIGN KEY (membership_id) REFERENCES membership (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_czech_ci;

-- ---------------------------------------------------------------- místa a akce

CREATE TABLE location (
  id       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  club_id  BIGINT UNSIGNED NOT NULL,
  name     VARCHAR(120) NOT NULL,
  address  VARCHAR(255) NULL,
  lat      DECIMAL(9,6) NULL,
  lng      DECIMAL(9,6) NULL,
  note     VARCHAR(255) NULL COMMENT 'napr. "vchod ze dvora, satna 3"',
  PRIMARY KEY (id),
  KEY ix_location_club (club_id),
  CONSTRAINT fk_location_club FOREIGN KEY (club_id) REFERENCES club (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_czech_ci;

CREATE TABLE event_series (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  season_id       BIGINT UNSIGNED NOT NULL,
  title           VARCHAR(120) NOT NULL,
  type            ENUM('training','match','other') NOT NULL DEFAULT 'training',
  rrule           VARCHAR(255) NOT NULL COMMENT 'iCalendar RRULE, napr. FREQ=WEEKLY;BYDAY=TU,TH',
  start_time      TIME NOT NULL,
  duration_min    SMALLINT UNSIGNED NOT NULL DEFAULT 90,
  location_id     BIGINT UNSIGNED NULL,
  meet_before_min SMALLINT UNSIGNED NULL,
  default_note    TEXT NULL,
  active_from     DATE NOT NULL,
  active_to       DATE NOT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_series_season (season_id),
  CONSTRAINT fk_series_season FOREIGN KEY (season_id) REFERENCES season (id) ON DELETE CASCADE,
  CONSTRAINT fk_series_location FOREIGN KEY (location_id) REFERENCES location (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_czech_ci;

CREATE TABLE event (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  season_id            BIGINT UNSIGNED NOT NULL,
  series_id            BIGINT UNSIGNED NULL,
  type                 ENUM('training','match','other') NOT NULL DEFAULT 'training',
  title                VARCHAR(120) NOT NULL,
  starts_at            DATETIME NOT NULL,
  ends_at              DATETIME NULL,
  meet_at              DATETIME NULL COMMENT 'cas srazu, u zapasu byva jiny nez zacatek',
  location_id          BIGINT UNSIGNED NULL,
  opponent             VARCHAR(120) NULL,
  note                 TEXT NULL,
  distance_km          SMALLINT UNSIGNED NULL COMMENT 'vzdalenost od domaci haly k soupeři (jednosmerna), podklad pro cestovni nahradu',
  nomination_deadline  DATETIME NULL,
  status               ENUM('planned','cancelled','done') NOT NULL DEFAULT 'planned',
  overridden           TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'rucne upraveno, pregenerovani serie to neprepise',
  created_at           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_event_season_date (season_id, starts_at),
  KEY ix_event_series (series_id),
  CONSTRAINT fk_event_season FOREIGN KEY (season_id) REFERENCES season (id) ON DELETE CASCADE,
  CONSTRAINT fk_event_series FOREIGN KEY (series_id) REFERENCES event_series (id) ON DELETE SET NULL,
  CONSTRAINT fk_event_location FOREIGN KEY (location_id) REFERENCES location (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_czech_ci;

-- Dochazka se NEZAPISUJE, jen OPRAVUJE:
--   hrac predem zaklikne rsvp -> po akci se z toho automaticky stane dochazka
--   (kdo se nezaklikl = nedorazil) -> admin/pinar prepise jen vyjimky.
-- Sloupec attendance je NULL, dokud nekdo neprovede rucni opravu; skutecny stav
-- vraci COALESCE(attendance, odvozeno z rsvp).
CREATE TABLE event_participant (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id      BIGINT UNSIGNED NOT NULL,
  membership_id BIGINT UNSIGNED NOT NULL,

  -- nominace se pouziva jen u zapasu, u treninku zustava 'none'
  nomination    ENUM('none','nominated','substitute') NOT NULL DEFAULT 'none',

  rsvp          ENUM('unknown','yes','no') NOT NULL DEFAULT 'unknown',
  rsvp_note     VARCHAR(255) NULL,
  rsvp_at       DATETIME NULL,

  -- NULL = zadna rucni oprava, plati odvozeni z rsvp
  -- 'injured' = zraneni / dlouhodoba nemoc, nepocita se do procenta ucasti
  attendance    ENUM('present','absent','injured') NULL DEFAULT NULL,
  attendance_by BIGINT UNSIGNED NULL,
  attendance_at DATETIME NULL,

  -- doprava na akci: zaroven domluva odvozu i podklad pro cestovni nahradu
  -- Jen dve hodnoty: beru auto, nebo neberu. Puvodni 'passenger' ("svezu se")
  -- se od 'none' nikde nelisil -- nikdo ho nezobrazoval ani nepocital.
  transport     ENUM('none','driver') NOT NULL DEFAULT 'none',
  car_seats     TINYINT UNSIGNED NULL COMMENT 'kolik mist ma ridic volnych',

  PRIMARY KEY (id),
  UNIQUE KEY uq_participant (event_id, membership_id),
  KEY ix_participant_member (membership_id, attendance),
  CONSTRAINT fk_participant_event FOREIGN KEY (event_id) REFERENCES event (id) ON DELETE CASCADE,
  CONSTRAINT fk_participant_membership FOREIGN KEY (membership_id) REFERENCES membership (id) ON DELETE CASCADE,
  CONSTRAINT fk_participant_by FOREIGN KEY (attendance_by) REFERENCES `user` (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_czech_ci;

-- Tajna adresa pro prubezne nacitany kalendar. Token se vraci jen pri vydani,
-- v databazi zustava pouze SHA-256 otisk. Opravneni se pri kazdem nacteni znovu
-- overuje proti zivemu clenstvi, takze odchod z druzstva feed okamzite vypne.
CREATE TABLE calendar_feed (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NOT NULL,
  team_id      BIGINT UNSIGNED NOT NULL,
  season_id    BIGINT UNSIGNED NOT NULL,
  token_hash   CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME NULL,
  revoked_at   DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_calendar_feed_token (token_hash),
  KEY ix_calendar_feed_owner (user_id, season_id, revoked_at),
  CONSTRAINT fk_calendar_feed_user FOREIGN KEY (user_id) REFERENCES `user` (id) ON DELETE CASCADE,
  CONSTRAINT fk_calendar_feed_team FOREIGN KEY (team_id) REFERENCES team (id) ON DELETE CASCADE,
  CONSTRAINT fk_calendar_feed_season FOREIGN KEY (season_id) REFERENCES season (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_czech_ci;

-- ---------------------------------------------------------------- prohřešky

-- Sazebnik je per sezona, a sezona per tym -> kazde druzstvo ma vlastni cenik.
CREATE TABLE offence_type (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  season_id   BIGINT UNSIGNED NOT NULL,
  name        VARCHAR(120) NOT NULL,
  amount_czk  INT NOT NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  category    ENUM('discipline','performance','fun','attendance') NULL,
  -- Ktery prohresek aplikace navrhne sama z dochazky. Omluvenou a neomluvenou
  -- absenci rozlisuje odpoved hrace predem: kdo rekl "neprijdu", je omluveny,
  -- kdo se neozval, neni. Pozdni prichod se odvodit neda -- cas prichodu nikdo
  -- nezaznamenava -- a zustava rucni.
  auto_rule   ENUM('none','excused_absence','unexcused_absence','late_arrival') NOT NULL DEFAULT 'none',

  -- U ktereho druhu akce pravidlo plati. Vsechna druzstva maji jinou sazbu za
  -- trenink a za zapas (junioři 25/100, muzi 35/100, Benatky 50/1000), takze
  -- samotne auto_rule nestaci -- podle nej by se strhla castka o stovky vedle.
  auto_event_type ENUM('any','training','match','other') NOT NULL DEFAULT 'any',
  archived_at DATETIME NULL,
  legacy_id   INT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_offence_type_legacy (legacy_id),
  KEY ix_offence_type_season (season_id, sort_order),
  CONSTRAINT fk_offence_type_season FOREIGN KEY (season_id) REFERENCES season (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_czech_ci;

-- Jedna zapisovaci seance -> souhrn pred odeslanim, jedno oznameni, storno vcelku.
CREATE TABLE offence_batch (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  season_id   BIGINT UNSIGNED NOT NULL,
  event_id    BIGINT UNSIGNED NULL,
  occurred_on DATE NOT NULL,
  title       VARCHAR(120) NULL,
  note        VARCHAR(255) NULL,
  client_uuid CHAR(36) NOT NULL COMMENT 'idempotence: dvojklik nezalozi dve davky',
  created_by  BIGINT UNSIGNED NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  voided_at   DATETIME NULL,
  voided_by   BIGINT UNSIGNED NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_batch_uuid (client_uuid),
  KEY ix_batch_season (season_id, occurred_on),
  CONSTRAINT fk_batch_season FOREIGN KEY (season_id) REFERENCES season (id) ON DELETE CASCADE,
  CONSTRAINT fk_batch_event FOREIGN KEY (event_id) REFERENCES event (id) ON DELETE SET NULL,
  CONSTRAINT fk_batch_creator FOREIGN KEY (created_by) REFERENCES `user` (id) ON DELETE SET NULL,
  CONSTRAINT fk_batch_voider FOREIGN KEY (voided_by) REFERENCES `user` (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_czech_ci;

CREATE TABLE offence_record (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  season_id       BIGINT UNSIGNED NOT NULL,
  membership_id   BIGINT UNSIGNED NOT NULL,
  offence_type_id BIGINT UNSIGNED NOT NULL,
  batch_id        BIGINT UNSIGNED NULL,
  event_id        BIGINT UNSIGNED NULL,
  amount_czk      INT NOT NULL COMMENT 'snapshot ceny v okamziku zapisu -- zmena ceniku neprepise historii',
  occurred_on     DATE NOT NULL,
  note            VARCHAR(255) NULL,
  created_by      BIGINT UNSIGNED NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  voided_at       DATETIME NULL COMMENT 'storno misto DELETE',
  voided_by       BIGINT UNSIGNED NULL,
  legacy_id       INT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_offence_legacy (legacy_id),
  KEY ix_offence_member (season_id, membership_id, voided_at),
  KEY ix_offence_date (season_id, occurred_on),
  KEY ix_offence_batch (batch_id),
  CONSTRAINT fk_offence_season FOREIGN KEY (season_id) REFERENCES season (id) ON DELETE CASCADE,
  CONSTRAINT fk_offence_membership FOREIGN KEY (membership_id) REFERENCES membership (id) ON DELETE CASCADE,
  CONSTRAINT fk_offence_type FOREIGN KEY (offence_type_id) REFERENCES offence_type (id) ON DELETE RESTRICT,
  CONSTRAINT fk_offence_batch FOREIGN KEY (batch_id) REFERENCES offence_batch (id) ON DELETE SET NULL,
  CONSTRAINT fk_offence_event FOREIGN KEY (event_id) REFERENCES event (id) ON DELETE SET NULL,
  CONSTRAINT fk_offence_creator FOREIGN KEY (created_by) REFERENCES `user` (id) ON DELETE SET NULL,
  CONSTRAINT fk_offence_voider FOREIGN KEY (voided_by) REFERENCES `user` (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_czech_ci;

-- ---------------------------------------------------------- cestovní náhrady

-- Nastaveni na urovni tymu. Cestaky jsou volitelne -- tym mladeze
-- je mit nemusi, tym muzu ano.
-- Pololeti se tady neresi: jeho hranici drzi season.half_year_on, protoze sezony
-- maji rozdilnou delku a prelom nebyva v jejich polovine.
CREATE TABLE team_settings (
  team_id             BIGINT UNSIGNED NOT NULL,
  bank_account        VARCHAR(50) NULL COMMENT 'pro QR platby (IBAN nebo cislo uctu)',
  home_location_id    BIGINT UNSIGNED NULL COMMENT 'domaci hala -- od ni se meri vzdalenost k souperi',
  travel_enabled      TINYINT(1) NOT NULL DEFAULT 0,
  travel_rate_czk_km  DECIMAL(5,2) NOT NULL DEFAULT 5.00,
  travel_round_trip   TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'proplaci se cesta tam i zpet (x2)',
  attendance_visible_to_players TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'dochazku ostatnich hraci nevidi',
  balances_visible_to_players   TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'dluhy ostatnich hraci vidi',
  PRIMARY KEY (team_id),
  CONSTRAINT fk_team_settings_team FOREIGN KEY (team_id) REFERENCES team (id) ON DELETE CASCADE,
  CONSTRAINT fk_team_settings_home FOREIGN KEY (home_location_id) REFERENCES location (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_czech_ci;

-- Narok na nahradu za cestu vlastnim autem.
-- Vznika VYHRADNE ridici (event_participant.transport='driver') a jen u venkovniho
-- zapasu -- spolujezdci narok nemaji.
-- Sazba se uklada jako snapshot, aby pozdejsi zmena sazby neprepsala vznikly narok.
-- Rusi se pres voided_at; zadna uzaverka radky nezamyka.
CREATE TABLE travel_claim (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  season_id      BIGINT UNSIGNED NOT NULL,
  membership_id  BIGINT UNSIGNED NOT NULL,
  event_id       BIGINT UNSIGNED NULL,
  occurred_on    DATE NOT NULL,
  distance_km    SMALLINT UNSIGNED NOT NULL,
  rate_czk_km    DECIMAL(5,2) NOT NULL COMMENT 'snapshot sazby v okamziku vzniku naroku',
  amount_czk     INT NOT NULL COMMENT 'distance_km * rate, zaokrouhleno',
  note           VARCHAR(255) NULL,
  created_by     BIGINT UNSIGNED NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  voided_at      DATETIME NULL,
  PRIMARY KEY (id),
  KEY ix_travel_member (season_id, membership_id, voided_at),
  CONSTRAINT fk_travel_season FOREIGN KEY (season_id) REFERENCES season (id) ON DELETE CASCADE,
  CONSTRAINT fk_travel_membership FOREIGN KEY (membership_id) REFERENCES membership (id) ON DELETE CASCADE,
  CONSTRAINT fk_travel_event FOREIGN KEY (event_id) REFERENCES event (id) ON DELETE SET NULL,
  CONSTRAINT fk_travel_creator FOREIGN KEY (created_by) REFERENCES `user` (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_czech_ci;

-- ---------------------------------------------------------------- platby

CREATE TABLE bank_transaction (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  club_id              BIGINT UNSIGNED NOT NULL,
  external_id          VARCHAR(64) NOT NULL COMMENT 'id z banky -> idempotentni import',
  amount_czk           INT NOT NULL,
  currency             CHAR(3) NOT NULL DEFAULT 'CZK',
  booked_on            DATE NOT NULL,
  variable_symbol      VARCHAR(10) NULL,
  counterparty_account VARCHAR(50) NULL,
  counterparty_name    VARCHAR(120) NULL,
  message              VARCHAR(255) NULL,
  raw_json             JSON NULL,
  status               ENUM('unmatched','matched','ignored') NOT NULL DEFAULT 'unmatched',
  matched_at           DATETIME NULL,
  imported_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bank_external (club_id, external_id),
  KEY ix_bank_status (club_id, status, booked_on),
  CONSTRAINT fk_bank_club FOREIGN KEY (club_id) REFERENCES club (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_czech_ci;

CREATE TABLE payment (
  id                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  season_id           BIGINT UNSIGNED NOT NULL,
  membership_id       BIGINT UNSIGNED NOT NULL,
  amount_czk          INT NOT NULL,
  paid_on             DATE NOT NULL,
  method              ENUM('cash','transfer','qr','gateway') NOT NULL DEFAULT 'cash',
  variable_symbol     VARCHAR(10) NULL,
  bank_transaction_id BIGINT UNSIGNED NULL,
  note                VARCHAR(255) NULL,
  confirmed_by        BIGINT UNSIGNED NULL,
  created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  voided_at           DATETIME NULL,
  PRIMARY KEY (id),
  KEY ix_payment_member (season_id, membership_id, voided_at),
  CONSTRAINT fk_payment_season FOREIGN KEY (season_id) REFERENCES season (id) ON DELETE CASCADE,
  CONSTRAINT fk_payment_membership FOREIGN KEY (membership_id) REFERENCES membership (id) ON DELETE CASCADE,
  CONSTRAINT fk_payment_bank FOREIGN KEY (bank_transaction_id) REFERENCES bank_transaction (id) ON DELETE SET NULL,
  CONSTRAINT fk_payment_confirmer FOREIGN KEY (confirmed_by) REFERENCES `user` (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_czech_ci;

-- ---------------------------------------------------------------- infrastruktura

CREATE TABLE refresh_token (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_refresh_hash (token_hash),
  KEY ix_refresh_user (user_id, expires_at),
  CONSTRAINT fk_refresh_user FOREIGN KEY (user_id) REFERENCES `user` (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_czech_ci;

CREATE TABLE invitation (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  team_id     BIGINT UNSIGNED NOT NULL,
  email       VARCHAR(190) NOT NULL,
  role        ENUM('admin','treasurer','player') NOT NULL DEFAULT 'player',
  token_hash  CHAR(64) NOT NULL,
  expires_at  DATETIME NOT NULL,
  accepted_at DATETIME NULL,
  invited_by  BIGINT UNSIGNED NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_invitation_hash (token_hash),
  KEY ix_invitation_team (team_id, accepted_at),
  CONSTRAINT fk_invitation_team FOREIGN KEY (team_id) REFERENCES team (id) ON DELETE CASCADE,
  CONSTRAINT fk_invitation_by FOREIGN KEY (invited_by) REFERENCES `user` (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_czech_ci;

CREATE TABLE password_reset (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at    DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_reset_hash (token_hash),
  CONSTRAINT fk_reset_user FOREIGN KEY (user_id) REFERENCES `user` (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_czech_ci;

-- Jen nepovedene pokusy, a jen po dobu, kdy maji vliv na limit. Uspesne
-- prihlaseni se nezaznamenava: do zadneho poctu nevstupuje a byl by z nej
-- trvaly seznam "kdo se odkud a kdy prihlasil", ktery nikdo nepotrebuje.
CREATE TABLE login_attempt (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email      VARCHAR(190) NOT NULL,
  ip         VARBINARY(16) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_attempt (email, created_at),
  KEY ix_attempt_ip (ip, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_czech_ci;

-- Provozni stopa citlivych zmen: kdo stornoval platbu, zdrazil prohresek nebo
-- odebral roli. Vaze se na druzstvo, protoze druzstvu patri kasa i opravneni --
-- klub drzi jen identitu. Zapisuje ji `Service\AuditLog` ve stejne transakci
-- jako samotnou zmenu; cte ji admin daneho druzstva.
CREATE TABLE audit_log (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  team_id        BIGINT UNSIGNED NULL,
  actor_user_id  BIGINT UNSIGNED NULL,
  action         VARCHAR(60) NOT NULL,
  entity         VARCHAR(60) NOT NULL,
  entity_id      BIGINT UNSIGNED NULL,
  payload        JSON NULL,
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_audit_team (team_id, created_at, id),
  KEY ix_audit_entity (entity, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_czech_ci;

-- device_id je nahodny identifikator prohlizece z localStorage. Adresa odberu se
-- pri kazde nove registraci service workera meni, takze bez nej po sobe jedno
-- zarizeni zanechava mrtve radky a aplikace pak tvrdi, ze je odber jinde.
CREATE TABLE push_subscription (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id          BIGINT UNSIGNED NOT NULL,
  device_id        CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  endpoint         VARCHAR(500) NOT NULL,
  endpoint_hash    CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  p256dh           VARCHAR(255) NOT NULL,
  auth             VARCHAR(255) NOT NULL,
  content_encoding ENUM('aes128gcm','aesgcm') NOT NULL DEFAULT 'aes128gcm',
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  failed_at        DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_push_endpoint_hash (endpoint_hash),
  UNIQUE KEY uq_push_device (user_id, device_id),
  KEY ix_push_user (user_id),
  CONSTRAINT fk_push_user FOREIGN KEY (user_id) REFERENCES `user` (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_czech_ci;

CREATE TABLE notification (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BIGINT UNSIGNED NOT NULL,
  type       VARCHAR(60) NOT NULL,
  title      VARCHAR(120) NOT NULL,
  body       VARCHAR(500) NOT NULL,
  link       VARCHAR(255) NULL,
  payload    JSON NULL,
  dedupe_key VARCHAR(191) NOT NULL,
  read_at    DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_notification_dedupe (user_id, type, dedupe_key),
  KEY ix_notification_user (user_id, read_at, created_at),
  CONSTRAINT fk_notification_user FOREIGN KEY (user_id) REFERENCES `user` (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_czech_ci;

-- Odesilaci fronta je po zarizenich: vypadek jednoho telefonu nesmi zpusobit
-- opakovane doruceni na jiny. Odesila ji az chranena cron uloha.
CREATE TABLE notification_queue (
  id                   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  notification_id      BIGINT UNSIGNED NOT NULL,
  push_subscription_id BIGINT UNSIGNED NOT NULL,
  channel              ENUM('push') NOT NULL DEFAULT 'push',
  status               ENUM('pending','processing','sent','failed') NOT NULL DEFAULT 'pending',
  attempts             TINYINT UNSIGNED NOT NULL DEFAULT 0,
  last_error           VARCHAR(255) NULL,
  send_after           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  locked_at            DATETIME NULL,
  sent_at              DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_queue_delivery (notification_id, push_subscription_id),
  KEY ix_queue_pending (status, send_after),
  CONSTRAINT fk_queue_notification FOREIGN KEY (notification_id) REFERENCES notification (id) ON DELETE CASCADE,
  CONSTRAINT fk_queue_subscription FOREIGN KEY (push_subscription_id) REFERENCES push_subscription (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_czech_ci;

CREATE TABLE notification_pref (
  user_id    BIGINT UNSIGNED NOT NULL,
  event_type VARCHAR(60) NOT NULL,
  channel    ENUM('push','email') NOT NULL,
  enabled    TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, event_type, channel),
  CONSTRAINT fk_pref_user FOREIGN KEY (user_id) REFERENCES `user` (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_czech_ci;

CREATE TABLE schema_migration (
  version    VARCHAR(60) NOT NULL,
  applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_czech_ci;

INSERT INTO schema_migration (version) VALUES ('001_init');
