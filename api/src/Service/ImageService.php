<?php

declare(strict_types=1);

namespace Pina\Service;

use GdImage;
use Pina\Auth\Identity;
use Pina\Auth\Role;
use Pina\Auth\TeamScope;
use Pina\Http\ApiException;
use Pina\Support\Database;
use RuntimeException;

/**
 * Profilové obrázky uživatelů a znaky družstev, vždy normalizované do bezpečného PNG.
 * Z animovaného GIFu zůstane první snímek — GD dál nevidí a rozhýbaný avatar
 * v seznamu jmen nikdo nechtěl.
 */
final class ImageService
{
    /**
     * Záložní hranice, ne ta hlavní. Klient obrázek zmenší už v prohlížeči, takže
     * sem doteče pár set kilobajtů; tohle drží velikost jen pro toho, kdo volá API
     * přímo. Výš to jít nemůže — v base64 je z toho o třetinu víc a `post_max_size`
     * je na hostingu 8 MB.
     */
    private const MAX_BYTES = 4 * 1024 * 1024;

    /**
     * GD si obrázek rozbalí na 4 bajty na pixel, takže limit nedrží velikost
     * souboru, ale `memory_limit` (na hostingu 128 MB): 16 Mpx je 64 MB, což se
     * ještě vejde. Bez téhle hranice by silně komprimovaná fotka v mezích 3 MB
     * shodila skript nedostatkem paměti — a to je 500, ne slušná chyba 400.
     * Nižší číslo dát nejde, běžná fotka z telefonu má 12 Mpx.
     */
    private const MAX_PIXELS = 16_000_000;

    private const OUTPUT_SIZE = 512;

    private readonly string $storagePath;

    public function __construct(
        private readonly Database $db,
        private readonly TeamScope $scope,
        string $rootPath,
    ) {
        $this->storagePath = $rootPath . '/storage/images';
    }

    public function saveUser(Identity $identity, string $dataUrl): string
    {
        return $this->save(
            'users',
            $dataUrl,
            fn (): mixed     => $this->db->value('SELECT avatar_url FROM `user` WHERE id = ?', [$identity->userId]),
            fn (string $url) => $this->db->run('UPDATE `user` SET avatar_url = ? WHERE id = ?', [$url, $identity->userId]),
            square: true,
        );
    }

    public function removeUser(Identity $identity): void
    {
        $oldUrl = $this->db->value('SELECT avatar_url FROM `user` WHERE id = ?', [$identity->userId]);
        $this->db->run('UPDATE `user` SET avatar_url = NULL WHERE id = ?', [$identity->userId]);
        $this->deleteStoredFile('users', $oldUrl);
    }

    public function saveTeam(Identity $identity, int $teamId, string $dataUrl): string
    {
        $this->scope->team($identity, $teamId, Role::Admin);

        return $this->save(
            'teams',
            $dataUrl,
            fn (): mixed     => $this->db->value('SELECT logo_url FROM team WHERE id = ?', [$teamId]),
            fn (string $url) => $this->db->run('UPDATE team SET logo_url = ? WHERE id = ?', [$url, $teamId]),
            square: false,
        );
    }

    public function removeTeam(Identity $identity, int $teamId): void
    {
        $this->scope->team($identity, $teamId, Role::Admin);

        $oldUrl = $this->db->value('SELECT logo_url FROM team WHERE id = ?', [$teamId]);
        $this->db->run('UPDATE team SET logo_url = NULL WHERE id = ?', [$teamId]);
        $this->deleteStoredFile('teams', $oldUrl);
    }

    public function contents(string $kind, string $filename): string
    {
        if (!in_array($kind, ['users', 'teams'], true) || preg_match('/^[a-f0-9]{32}\.png$/', $filename) !== 1) {
            throw ApiException::notFound();
        }

        $path     = $this->storagePath . '/' . $kind . '/' . $filename;
        $contents = is_file($path) ? file_get_contents($path) : false;

        if (!is_string($contents)) {
            throw ApiException::notFound();
        }

        return $contents;
    }

    /**
     * @param callable():mixed        $currentUrl
     * @param callable(string):mixed $persist
     */
    private function save(string $kind, string $dataUrl, callable $currentUrl, callable $persist, bool $square): string
    {
        $contents  = $this->normalize($dataUrl, $square);
        $filename  = bin2hex(random_bytes(16)) . '.png';
        $directory = $this->storagePath . '/' . $kind;

        if (!is_dir($directory) && !mkdir($directory, 0750, true) && !is_dir($directory)) {
            throw new RuntimeException('Adresář pro obrázky se nepodařilo vytvořit.');
        }

        $path = $directory . '/' . $filename;
        if (file_put_contents($path, $contents, LOCK_EX) === false) {
            throw new RuntimeException('Obrázek se nepodařilo uložit.');
        }

        $url    = '/api/v1/images/' . $kind . '/' . $filename;
        $oldUrl = $currentUrl();

        try {
            $persist($url);
        } catch (\Throwable $e) {
            unlink($path);
            throw $e;
        }

        $this->deleteStoredFile($kind, $oldUrl);

        return $url;
    }

    private function normalize(string $dataUrl, bool $square): string
    {
        if (preg_match('#^data:(image/(?:jpeg|png|gif|webp));base64,(.+)$#s', $dataUrl, $matches) !== 1) {
            throw ApiException::validation('Vyberte obrázek ve formátu JPEG, PNG, GIF nebo WebP.', ['field' => 'image']);
        }

        $source = base64_decode($matches[2], true);
        if (!is_string($source) || $source === '') {
            throw ApiException::validation('Soubor obrázku je poškozený.', ['field' => 'image']);
        }
        if (strlen($source) > self::MAX_BYTES) {
            throw ApiException::validation('Obrázek může mít nejvýše 4 MB.', ['field' => 'image']);
        }

        $info     = getimagesizefromstring($source);
        $accepted = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if ($info === false || !in_array($info['mime'], $accepted, true)) {
            throw ApiException::validation('Soubor není platný obrázek JPEG, PNG, GIF nebo WebP.', ['field' => 'image']);
        }

        $this->assertDecodable((string) $info['mime']);

        [$width, $height] = $info;
        if ($width < 1 || $height < 1 || $width * $height > self::MAX_PIXELS) {
            throw ApiException::validation('Obrázek má příliš velké rozměry.', ['field' => 'image']);
        }

        $image = imagecreatefromstring($source);
        if (!$image instanceof GdImage) {
            throw ApiException::validation('Soubor obrázku se nepodařilo přečíst.', ['field' => 'image']);
        }

        [$outWidth, $outHeight, $sourceX, $sourceY, $sourceWidth, $sourceHeight] = $square
            ? $this->squareCrop($width, $height)
            : $this->fitBox($width, $height);

        $target = imagecreatetruecolor($outWidth, $outHeight);
        if (!$target instanceof GdImage) {
            throw new RuntimeException('Obrázek se nepodařilo připravit.');
        }

        imagealphablending($target, false);
        imagesavealpha($target, true);
        $transparent = imagecolorallocatealpha($target, 0, 0, 0, 127);
        if ($transparent === false) {
            throw new RuntimeException('Průhlednost obrázku se nepodařilo připravit.');
        }
        imagefill($target, 0, 0, $transparent);

        imagecopyresampled(
            $target,
            $image,
            0,
            0,
            $sourceX,
            $sourceY,
            $outWidth,
            $outHeight,
            $sourceWidth,
            $sourceHeight,
        );

        ob_start();
        $written = imagepng($target, null, 8);
        $result  = ob_get_clean();

        if (!$written || !is_string($result)) {
            throw new RuntimeException('Obrázek se nepodařilo převést.');
        }

        return $result;
    }

    /**
     * Výřez na čtverec. Kolečko u jména musí být vyplněné celé, a tvář se dívá
     * doprostřed, takže osekání z kraje je u profilového obrázku správně.
     *
     * @param positive-int $width
     * @param positive-int $height
     *
     * @return array{positive-int,positive-int,int,int,positive-int,positive-int}
     *     cílová šířka a výška, počátek výřezu, jeho šířka a výška
     */
    private function squareCrop(int $width, int $height): array
    {
        $side = min($width, $height);

        return [
            self::OUTPUT_SIZE,
            self::OUTPUT_SIZE,
            intdiv($width - $side, 2),
            intdiv($height - $side, 2),
            $side,
            $side,
        ];
    }

    /**
     * Vepsání do krabice bez osekání. Znak klubu je skoro vždycky na šířku a
     * čtvercový výřez by mu odřízl kraje — u loga to není detail, ale zmrzačení.
     * Nezvětšuje se: malý znak zůstane malý, roztažením by se jen rozmazal.
     *
     * @param positive-int $width
     * @param positive-int $height
     *
     * @return array{positive-int,positive-int,int,int,positive-int,positive-int}
     */
    private function fitBox(int $width, int $height): array
    {
        $scale = min(1.0, self::OUTPUT_SIZE / max($width, $height));

        return [
            max(1, (int) round($width * $scale)),
            max(1, (int) round($height * $scale)),
            0,
            0,
            $width,
            $height,
        ];
    }

    /**
     * GD se dá přeložit bez JPEG i bez WebP — rozšíření pak vypadá funkční, ale
     * na fotku z telefonu vrátí jen `false`. Bez tohohle by z toho byla hláška
     * „obrázek se nepodařilo přečíst", tedy obvinění souboru z něčeho, co je
     * chyba serveru.
     */
    private function assertDecodable(string $mime): void
    {
        $keys = [
            'image/jpeg' => 'JPEG Support',
            'image/png'  => 'PNG Support',
            'image/gif'  => 'GIF Read Support',
            'image/webp' => 'WebP Support',
        ];
        $support = gd_info();

        if (($support[$keys[$mime] ?? ''] ?? false) === true) {
            return;
        }

        throw ApiException::validation(
            'Tenhle formát obrázku server zpracovat neumí. Uložte ho jako PNG a zkuste to znovu.',
            ['field' => 'image'],
        );
    }

    private function deleteStoredFile(string $kind, mixed $url): void
    {
        if (!is_string($url)) {
            return;
        }

        $prefix = '/api/v1/images/' . $kind . '/';
        if (!str_starts_with($url, $prefix)) {
            return;
        }

        $filename = substr($url, strlen($prefix));
        if (preg_match('/^[a-f0-9]{32}\.png$/', $filename) !== 1) {
            return;
        }

        $path = $this->storagePath . '/' . $kind . '/' . $filename;
        if (is_file($path)) {
            unlink($path);
        }
    }
}
