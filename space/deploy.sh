#!/usr/bin/env bash
# Deploy the Clipora AI backend to a free Hugging Face Docker Space.
# Usage:  HF_TOKEN=hf_xxx space/deploy.sh   → https://<user>-clipora-ai.hf.space
set -euo pipefail
: "${HF_TOKEN:?Set HF_TOKEN to a Hugging Face token with write access}"
HF_USER="${HF_USER:-rabeya100X}"
SPACE="${HF_SPACE:-clipora-ai}"
cd "$(dirname "$0")"
curl -sf -X POST -H "Authorization: Bearer $HF_TOKEN" -H "Content-Type: application/json" \
  https://huggingface.co/api/repos/create \
  -d "{\"type\":\"space\",\"name\":\"$SPACE\",\"sdk\":\"docker\",\"private\":false}" >/dev/null \
  || echo "Space exists (or could not be created) – continuing with upload"
tmp="$(mktemp -d)"
cp app.py requirements.txt Dockerfile README.md "$tmp/"
cd "$tmp"
git init -q -b main
git add -A
git -c user.name="$HF_USER" -c user.email="$HF_USER@users.noreply.huggingface.co" commit -qm "Deploy Clipora AI"
git push -q --force "https://$HF_USER:$HF_TOKEN@huggingface.co/spaces/$HF_USER/$SPACE" main
rm -rf "$tmp"
echo "Deployed: https://huggingface.co/spaces/$HF_USER/$SPACE"
echo "API:      https://$(echo "$HF_USER-$SPACE" | tr '[:upper:]_' '[:lower:]-').hf.space"
