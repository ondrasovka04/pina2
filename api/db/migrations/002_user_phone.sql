-- Jednorázově pro existující databáze, před nasazením kódu s telefonem.
-- Nová instalace už má sloupec v 001_init.sql a tento soubor nespouští.
ALTER TABLE `user`
  ADD COLUMN phone VARCHAR(13) NULL COMMENT 'ceske cislo s predponou +420; kontakt pro adminy druzstev' AFTER avatar_url;
