#!/usr/bin/env bash
# One-time VM bootstrap — run ONCE by hand, right after the VM is created.
# Not part of the deploy pipeline: deploy.yml/redeploy.sh assume this has
# already been done and never re-run it.
#
# Run this over the same IAP-tunnelled SSH the deploy workflow uses:
#   gcloud compute ssh <VM_NAME> --zone=<ZONE> --tunnel-through-iap
#   (copy this file over first, or paste its contents into the session)
#   sudo bash setup-vm.sh <ARTIFACT_REGISTRY_REGION>
#
# Region must match wherever the Artifact Registry repo actually lives
# (deploy.yml's vars.GCP_REGION for the real deploy) — pass it as the one
# argument, e.g.: sudo bash setup-vm.sh asia-south1

set -euo pipefail

REGION="${1:?Usage: sudo bash setup-vm.sh <ARTIFACT_REGISTRY_REGION>}"

echo "Installing Docker..."
curl -fsSL https://get.docker.com | sh

echo "Allowing the current user to run docker without sudo..."
usermod -aG docker "${SUDO_USER:-$USER}"

echo "Checking gcloud CLI..."
if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud not found — installing..."
  apt-get update
  apt-get install -y google-cloud-cli
else
  echo "gcloud already present: $(gcloud --version | head -n1)"
fi

echo "Configuring Docker authentication for Artifact Registry..."
# redeploy.sh runs `docker compose` via sudo, so this must be configured for
# root — configuring it for the regular login user only would leave root's
# docker pull unauthenticated, exactly the "Unauthenticated request" error
# this fixes.
gcloud auth configure-docker "${REGION}-docker.pkg.dev" --quiet

echo "Creating /opt/growth-center..."
mkdir -p /opt/growth-center

echo "Done. Log out and back in (or start a new SSH session) for the docker group change to take effect."
