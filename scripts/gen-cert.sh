#!/bin/bash
# Generate self-signed SSL certificate for development
# Usage: bash scripts/gen-cert.sh

CERT_DIR="certs"
mkdir -p "$CERT_DIR"

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$CERT_DIR/key.pem" \
  -out "$CERT_DIR/cert.pem" \
  -days 365 \
  -subj "/CN=localhost"

echo "Generated: $CERT_DIR/key.pem, $CERT_DIR/cert.pem"
echo ""
echo "Start with SSL:"
echo "  SSL_KEY=certs/key.pem SSL_CERT=certs/cert.pem npm start"
