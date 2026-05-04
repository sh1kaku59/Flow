#!/bin/sh
set -e

# Update these before running on the VM
DOMAIN=flowvn.me
EMAIL=nguyenvuhuy12a1@gmail.com

# Ensure webroot exists
mkdir -p ./reverse-proxy/certbot/www
mkdir -p ./reverse-proxy/certbot/conf

# Start nginx on HTTP so certbot can validate the challenge
docker compose up -d reverse-proxy

# Issue certificate (HTTP-01)
docker compose run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  -d "$DOMAIN" -d "www.$DOMAIN" \
  --email "$EMAIL" --agree-tos --no-eff-email

# Reload nginx to use new certs
docker compose restart reverse-proxy
