# Shoda s produkcí: PHP 8.5 na Czechia/Zoner.
FROM php:8.5-cli

RUN apt-get update && apt-get install -y --no-install-recommends \
        libicu-dev libzip-dev libgmp-dev libpng-dev libjpeg-dev libwebp-dev libonig-dev default-mysql-client \
    # GD se bez --with-jpeg a --with-webp přeloží jen s PNG. Vypadá to jako
    # funkční rozšíření, ale imagecreatefromstring pak na fotku z telefonu vrátí
    # false — profilové obrázky se kvůli tomu nedaly nahrát vůbec.
    && docker-php-ext-configure gd --with-jpeg --with-webp \
    && docker-php-ext-install -j"$(nproc)" pdo_mysql intl zip gmp bcmath gd \
    && rm -rf /var/lib/apt/lists/*

# sodium (Argon2id) je v obrazu už zkompilovaný, stejně jako na hostingu
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /app
