-- Pryc s udaji, ktere se zapisovaly a nikdo je necetl.
--
-- Osobni udaj, se kterym aplikace nic nedela, neni zaloha do budoucna, ale zbytecne
-- riziko -- a u kadetu jde o data nezletilych. Co se ma dochovat, patri do audit_log.
--
-- Pro koho to je: pro databazi, ktera uz v novem schematu bezi (vyvojova).
-- Nove zalozena to nepotrebuje, 001_init.sql uz tyhle sloupce nema.

-- Adresa a prohlizec u obnovovaciho tokenu. Zapisovaly se pri kazdem prihlaseni,
-- ale SELECT nad refresh_token tahne jen id, user_id, expires_at a revoked_at.
-- Mely slouzit obrazovce "prihlasena zarizeni", ktera nevznikla.
ALTER TABLE refresh_token DROP COLUMN user_agent, DROP COLUMN ip;

-- Cas posledniho prihlaseni necetl nikdo. Az bude potreba "naposledy prihlasen",
-- da se zavest znovu -- je to jedno NOW() pri prihlaseni, nic se neztraci.
ALTER TABLE `user` DROP COLUMN last_login_at;

-- Telefon se nikdy nikam nezapisoval ani necetl, byl ve schematu naprazdno.
ALTER TABLE `user` DROP COLUMN phone;

-- Uspesne pokusy o prihlaseni. Limiter pocita jen neuspesne, takze radek
-- se `succeeded = 1` neovlivnoval nic a jen pribyval.
DELETE FROM login_attempt WHERE succeeded = 1;
ALTER TABLE login_attempt DROP COLUMN succeeded;

-- Stare zaznamy uz na limit vliv nemaji; dal je udrzuje RateLimiter sam.
DELETE FROM login_attempt WHERE created_at < DATE_SUB(NOW(), INTERVAL 24 HOUR);

INSERT INTO schema_migration (version) VALUES ('003_pryc_s_nectenymi_udaji');
