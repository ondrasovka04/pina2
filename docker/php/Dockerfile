# Shoda s produkcí: PHP 8.5 na Czechia/Zoner.
FROM php:8.5-cli

RUN apt-get update && apt-get install -y --no-install-recommends \
        libicu-dev libzip-dev libgmp-dev libpng-dev libonig-dev default-mysql-client \
    && docker-php-ext-install -j"$(nproc)" pdo_mysql intl zip gmp bcmath gd \
    && rm -rf /var/lib/apt/lists/*

# sodium (Argon2id) je v obrazu už zkompilovaný, stejně jako na hostingu
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /app
