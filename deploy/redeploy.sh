#!/usr/bin/env bash
# Lives on the VM at /opt/growth-center/redeploy.sh. Run by the GitHub Actions
# deploy step over SSH after it copies the latest docker-compose.yml here.
#
# Only lists SECRET NAMES below — never values. Each value is pulled fresh
# from GCP Secret Manager, using the VM's own service account identity, right
# before `docker compose up`. Nothing secret ever passes through GitHub
# Actions, SSH command text, or shell history — only through this script's
# own `gcloud secrets versions access` calls.
#
# One-time setup this script assumes:
#   - Every name below exists as a secret in Secret Manager (same name).
#   - The VM's service account (not the CI deploy service account) has been
#     granted roles/secretmanager.secretAccessor on the project.
#
# The .env file below is regenerated on every deploy and stays at
# /opt/growth-center/.env with 600 permissions — root-owned, unreadable by
# any other user on the VM, and always in sync with the current Secret
# Manager values (so it's never a stale copy someone forgot about).

set -euo pipefail
cd /opt/growth-center

SECRET_NAMES=(
  DATABASE_URL
  DIRECT_URL
  NEXTAUTH_SECRET
  NEXTAUTH_URL
  GOOGLE_CLIENT_ID
  GOOGLE_CLIENT_SECRET
  APP_ENCRYPTION_KEY
  CRON_SECRET
  META_APP_ID
  META_APP_SECRET
  ZOHO_CLIENT_ID
  ZOHO_CLIENT_SECRET
  ZOHO_DC
  ZOHO_PROJECTS_CLIENT_ID
  ZOHO_PROJECTS_CLIENT_SECRET
  GOOGLE_ADS_DEVELOPER_TOKEN
  LINKEDIN_CLIENT_ID
  LINKEDIN_CLIENT_SECRET
  ANTHROPIC_API_KEY
  SMTP_HOST
  SMTP_PORT
  SMTP_USER
  SMTP_PASSWORD
  SMTP_FROM
  CLIQ_WEBHOOK_URL
)

echo "Fetching ${#SECRET_NAMES[@]} secrets from Secret Manager..."

TMP_ENV="$(mktemp)"
trap 'rm -f "$TMP_ENV"' EXIT

for name in "${SECRET_NAMES[@]}"; do
  # Optional secrets (Zoho, Meta, LinkedIn, Google Ads, AI, SMTP, Cliq) may not
  # exist yet — fall back to empty rather than failing the whole deploy, same
  # as the app's own "not configured" degradation for these.
  value="$(gcloud secrets versions access latest --secret="$name" 2>/dev/null || echo "")"
  printf '%s=%s\n' "$name" "$value" >> "$TMP_ENV"
done

install -m 600 -o root -g root "$TMP_ENV" .env

echo "Wrote .env ($(wc -l < .env) vars, mode 600)."

sudo docker compose pull
sudo docker compose up -d --remove-orphans

echo "Deploy complete."
