#!/bin/bash
# init-letsencrypt.sh — Bootstrap Let's Encrypt certificates
# Usage: ./init-letsencrypt.sh
# Run ONCE before the first `docker compose up`

set -e

DOMAINS=(panel.yourdomain.com link.yourdomain.com)
EMAIL="admin@yourdomain.com"  # Change this
STAGING=0  # Set to 1 for testing to avoid rate limits

DATA_PATH="./certbot"
RSA_KEY_SIZE=4096

echo "### Creating required directories..."
mkdir -p "$DATA_PATH/conf" "$DATA_PATH/www"

echo "### Downloading recommended TLS parameters..."
if [ ! -e "$DATA_PATH/conf/options-ssl-nginx.conf" ] || [ ! -e "$DATA_PATH/conf/ssl-dhparams.pem" ]; then
  curl -s https://raw.githubusercontent.com/certbot/certbot/master/certbot-nginx/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf > "$DATA_PATH/conf/options-ssl-nginx.conf"
  curl -s https://raw.githubusercontent.com/certbot/certbot/master/certbot/certbot/ssl-dhparams.pem > "$DATA_PATH/conf/ssl-dhparams.pem"
fi

echo "### Creating dummy certificates for nginx to start..."
for domain in "${DOMAINS[@]}"; do
  cert_path="$DATA_PATH/conf/live/$domain"
  mkdir -p "$cert_path"
  if [ ! -e "$cert_path/fullchain.pem" ]; then
    openssl req -x509 -nodes -newkey rsa:1024 -days 1 \
      -keyout "$cert_path/privkey.pem" \
      -out "$cert_path/fullchain.pem" \
      -subj "/CN=localhost" 2>/dev/null
  fi
done

echo "### Starting nginx..."
docker compose up -d nginx

echo "### Removing dummy certificates..."
for domain in "${DOMAINS[@]}"; do
  rm -rf "$DATA_PATH/conf/live/$domain"
done

echo "### Requesting real certificates..."
for domain in "${DOMAINS[@]}"; do
  staging_arg=""
  if [ $STAGING -eq 1 ]; then staging_arg="--staging"; fi

  docker compose run --rm certbot certonly --webroot \
    -w /var/www/certbot \
    --email "$EMAIL" \
    -d "$domain" \
    --rsa-key-size $RSA_KEY_SIZE \
    --agree-tos \
    --no-eff-email \
    --force-renewal \
    $staging_arg
done

echo "### Reloading nginx..."
docker compose exec nginx nginx -s reload

echo "### Done! Certificates obtained for: ${DOMAINS[*]}"
