<?php

declare(strict_types=1);

namespace Pina\Support;

/**
 * Termín, do kdy se má hráč zapsat na akci.
 *
 * Dědí se živě: ruční termín u akce má přednost, jinak platí počet hodin
 * z nastavení družstva. Družstvo bez řádku nastavení termín má — výchozí stav je
 * zapnuto a řádek `team_settings` vzniká až prvním uložením nastavení.
 *
 * Výraz i výchozí hodiny bydlí tady schválně. Kdyby stály zvlášť v `EventService`
 * a v `NotificationService`, můžou se rozejít beze stopy: připomínka by odcházela
 * podle jiného termínu, než jaký aplikace ukazuje.
 */
final class RsvpDeadline
{
    /**
     * Tytéž hodnoty jsou i jako DEFAULT sloupců v `001_init.sql` — SQL se na
     * konstantu odkázat neumí. Když se mění, mění se na obou místech.
     */
    public const DEFAULT_TRAINING_HOURS = 24;

    public const DEFAULT_MATCH_HOURS = 48;

    /**
     * SQL výraz s výsledným termínem, nebo `NULL`, když se termín neřeší.
     * Počítá s aliasy `e` (event) a `ts` (team_settings připojené přes sezónu
     * pomocí LEFT JOIN). Neobsahuje žádný vstup od uživatele.
     */
    public static function sqlExpression(): string
    {
        $training = self::DEFAULT_TRAINING_HOURS;
        $match    = self::DEFAULT_MATCH_HOURS;

        return "COALESCE(
                    e.rsvp_deadline_at,
                    CASE e.type
                        WHEN 'training' THEN DATE_SUB(
                            e.starts_at,
                            INTERVAL IF(ts.team_id IS NULL, $training, ts.rsvp_deadline_training_hours) HOUR
                        )
                        WHEN 'match' THEN DATE_SUB(
                            e.starts_at,
                            INTERVAL IF(ts.team_id IS NULL, $match, ts.rsvp_deadline_match_hours) HOUR
                        )
                    END
                )";
    }
}
