<?php

declare(strict_types=1);

namespace Pina\Tests\Integration;

use GdImage;
use Pina\Auth\Identity;
use Pina\Auth\Role;
use Pina\Auth\TeamScope;
use Pina\Http\ApiException;
use Pina\Service\ImageService;

final class ImageServiceTest extends DatabaseTestCase
{
    private string $rootPath;

    private ImageService $images;

    private int $clubId;

    private int $teamId;

    private int $userId;

    private Identity $admin;

    private Identity $player;

    protected function setUp(): void
    {
        parent::setUp();

        $this->rootPath                = sys_get_temp_dir() . '/pina-images-' . bin2hex(random_bytes(8));
        [$this->clubId, $this->teamId] = $this->makeTeam('prosek', 'Muži');

        $this->userId = $this->makeUser('admin@prosek.cz');
        $this->makeMembership($this->userId, $this->teamId, 'admin');
        $this->admin = $this->identity($this->userId, $this->teamId, Role::Admin);

        $playerId = $this->makeUser('hrac@prosek.cz');
        $this->makeMembership($playerId, $this->teamId, 'player');
        $this->player = $this->identity($playerId, $this->teamId, Role::Player);

        $this->images = new ImageService($this->db, new TeamScope($this->db), $this->rootPath);
    }

    protected function tearDown(): void
    {
        $this->removeDirectory($this->rootPath);
        parent::tearDown();
    }

    public function testUserSavesNormalizedAvatarAndCanReadIt(): void
    {
        $url = $this->images->saveUser($this->admin, $this->imageDataUrl());

        self::assertMatchesRegularExpression('#^/api/v1/images/users/[a-f0-9]{32}\.png$#', $url);
        self::assertSame($url, $this->db->value('SELECT avatar_url FROM `user` WHERE id = ?', [$this->userId]));

        $contents = $this->contentsFromUrl($url);
        $info     = getimagesizefromstring($contents);

        self::assertIsArray($info);
        self::assertSame('image/png', $info['mime']);
        self::assertSame(512, $info[0]);
        self::assertSame(512, $info[1]);
    }

    public function testReplacingAndRemovingAvatarCleansOldFiles(): void
    {
        $first  = $this->images->saveUser($this->admin, $this->imageDataUrl());
        $second = $this->images->saveUser($this->admin, $this->imageDataUrl());

        self::assertNotSame($first, $second);
        $this->expectNotFound(fn (): string => $this->contentsFromUrl($first));
        self::assertNotSame('', $this->contentsFromUrl($second));

        $this->images->removeUser($this->admin);

        self::assertNull($this->db->value('SELECT avatar_url FROM `user` WHERE id = ?', [$this->userId]));
        $this->expectNotFound(fn (): string => $this->contentsFromUrl($second));
    }

    public function testTeamAdminSavesLogoButPlayerCannot(): void
    {
        $url = $this->images->saveTeam($this->admin, $this->teamId, $this->imageDataUrl());

        self::assertSame($url, $this->db->value('SELECT logo_url FROM team WHERE id = ?', [$this->teamId]));

        // 403, ne 404: vlastní družstvo hráč vidí, jen na znak nemá roli. Cizí
        // družstvo naopak nesmí prozradit, že existuje — viz testy níž.
        try {
            $this->images->saveTeam($this->player, $this->teamId, $this->imageDataUrl());
            self::fail('Hráč nesmí měnit znak družstva.');
        } catch (ApiException $e) {
            self::assertSame(403, $e->status);
        }
    }

    /**
     * Znak patří družstvu, ne klubu: admin mužů nesmí sáhnout na znak juniorů,
     * i když jsou v tomtéž klubu. Dřív se ukládal na klub a přepsal je oba.
     */
    public function testAdminOfSiblingTeamInSameClubGetsNotFound(): void
    {
        $siblingTeamId = $this->makeTeamInClub($this->clubId, 'Junioři');

        try {
            $this->images->saveTeam($this->admin, $siblingTeamId, $this->imageDataUrl());
            self::fail('Cizí družstvo musí vypadat jako neexistující.');
        } catch (ApiException $e) {
            self::assertSame(404, $e->status);
        }

        self::assertNull($this->db->value('SELECT logo_url FROM team WHERE id = ?', [$siblingTeamId]));
    }

    public function testAdminOfForeignClubGetsNotFound(): void
    {
        [, $foreignTeamId] = $this->makeTeam('benatky', 'Benátky');
        $foreignUserId     = $this->makeUser('admin@benatky.cz');
        $this->makeMembership($foreignUserId, $foreignTeamId, 'admin');
        $foreignAdmin = $this->identity($foreignUserId, $foreignTeamId, Role::Admin);

        try {
            $this->images->saveTeam($foreignAdmin, $this->teamId, $this->imageDataUrl());
            self::fail('Cizí družstvo musí vypadat jako neexistující.');
        } catch (ApiException $e) {
            self::assertSame(404, $e->status);
        }
    }

    /**
     * Fotka z telefonu je JPEG. GD přeložené jen s PNG na ni vrátí `false`
     * a nahrání skončí chybou — obrázky se kvůli tomu nedaly nastavit vůbec,
     * a testy to nepoznaly, protože pracovaly jedině s PNG.
     */
    public function testPhotoFromPhoneIsAccepted(): void
    {
        $url = $this->images->saveUser($this->admin, $this->jpegDataUrl());

        $info = getimagesizefromstring($this->contentsFromUrl($url));
        self::assertIsArray($info);
        self::assertSame('image/png', $info['mime']);
        self::assertSame(512, $info[0]);
    }

    /** GIF se bere taky a jako všechno ostatní z něj vyleze PNG. */
    public function testGifIsConvertedToPng(): void
    {
        $url = $this->images->saveUser($this->admin, $this->gifDataUrl());

        $info = getimagesizefromstring($this->contentsFromUrl($url));
        self::assertIsArray($info);
        self::assertSame('image/png', $info['mime']);
    }

    /** Znak je skoro vždy na šířku; výřez na čtverec by mu odřízl kraje. */
    public function testTeamLogoKeepsItsAspectRatio(): void
    {
        $url = $this->images->saveTeam($this->admin, $this->teamId, $this->imageDataUrl(1200, 300));

        $info = getimagesizefromstring($this->contentsFromUrl($url));
        self::assertIsArray($info);
        self::assertSame(512, $info[0]);
        self::assertSame(128, $info[1]);
    }

    /** Profilový obrázek naopak čtvercový být musí, aby vyplnil kolečko. */
    public function testAvatarIsCroppedToSquare(): void
    {
        $url = $this->images->saveUser($this->admin, $this->imageDataUrl(1200, 300));

        $info = getimagesizefromstring($this->contentsFromUrl($url));
        self::assertIsArray($info);
        self::assertSame([512, 512], [$info[0], $info[1]]);
    }

    public function testInvalidImageIsRejectedWithoutDatabaseChange(): void
    {
        try {
            $this->images->saveUser($this->admin, 'data:image/png;base64,' . base64_encode('není obrázek'));
            self::fail('Neplatný obrázek musí být odmítnutý.');
        } catch (ApiException $e) {
            self::assertSame(400, $e->status);
            self::assertSame('image', $e->details['field']);
        }

        self::assertNull($this->db->value('SELECT avatar_url FROM `user` WHERE id = ?', [$this->userId]));
    }

    /**
     * @param positive-int $width
     * @param positive-int $height
     */
    private function imageDataUrl(int $width = 40, int $height = 20): string
    {
        ob_start();
        imagepng($this->blueImage($width, $height));
        $contents = ob_get_clean();
        self::assertIsString($contents);

        return 'data:image/png;base64,' . base64_encode($contents);
    }

    private function jpegDataUrl(): string
    {
        ob_start();
        imagejpeg($this->blueImage(600, 400));
        $contents = ob_get_clean();
        self::assertIsString($contents);
        self::assertNotSame('', $contents, 'GD v tomhle PHP neumí JPEG — chybí --with-jpeg.');

        return 'data:image/jpeg;base64,' . base64_encode($contents);
    }

    private function gifDataUrl(): string
    {
        ob_start();
        imagegif($this->blueImage(60, 60));
        $contents = ob_get_clean();
        self::assertIsString($contents);

        return 'data:image/gif;base64,' . base64_encode($contents);
    }

    /**
     * @param positive-int $width
     * @param positive-int $height
     */
    private function blueImage(int $width, int $height): GdImage
    {
        $image = imagecreatetruecolor($width, $height);
        self::assertInstanceOf(GdImage::class, $image);

        $blue = imagecolorallocate($image, 20, 80, 180);
        self::assertIsInt($blue);
        imagefill($image, 0, 0, $blue);

        return $image;
    }

    private function contentsFromUrl(string $url): string
    {
        $parts = explode('/', $url);

        return $this->images->contents((string) $parts[4], (string) $parts[5]);
    }

    /** @param callable():string $read */
    private function expectNotFound(callable $read): void
    {
        try {
            $read();
            self::fail('Smazaný obrázek se nesmí dál načíst.');
        } catch (ApiException $e) {
            self::assertSame(404, $e->status);
        }
    }

    private function identity(int $userId, int $teamId, Role $role): Identity
    {
        return new Identity($userId, 'uzivatel@example.cz', 'Uživatel', false, [$teamId => $role]);
    }

    private function removeDirectory(string $path): void
    {
        if (!is_dir($path)) {
            return;
        }

        $items = scandir($path);
        if (!is_array($items)) {
            return;
        }

        foreach ($items as $item) {
            if ($item === '.' || $item === '..') {
                continue;
            }

            $child = $path . '/' . $item;
            if (is_dir($child)) {
                $this->removeDirectory($child);
            } else {
                unlink($child);
            }
        }

        rmdir($path);
    }
}
