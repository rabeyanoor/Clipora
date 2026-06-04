#!/usr/bin/env bash
# Deploy Clipora to a free static Hugging Face Space (HTTPS hosting, needed for Play Store).
# Usage:  HF_TOKEN=hf_xxx ./deploy-hf.sh
set -euo pipefail
: "${HF_TOKEN:?Set HF_TOKEN to a Hugging Face token with write access}"
HF_USER="${HF_USER:-rabeya100X}"
SPACE="${HF_SPACE:-clipora}"
cd "$(dirname "$0")"

curl -sf -X POST -H "Authorization: Bearer $HF_TOKEN" -H "Content-Type: application/json" \
  https://huggingface.co/api/repos/create \
  -d "{\"type\":\"space\",\"name\":\"$SPACE\",\"sdk\":\"static\",\"private\":false}" >/dev/null \
  || echo "Space exists (or could not be created) – continuing with upload"

tmp="$(mktemp -d)"
cp -r index.html manifest.webmanifest sw.js css js icons "$tmp/"
[ -d .well-known ] && cp -r .well-known "$tmp/"
cat > "$tmp/README.md" <<MD
---
title: Clipora
emoji: 🎬
colorFrom: purple
colorTo: pink
sdk: static
app_file: index.html
pinned: false
---
Clipora – free AI video editor for Reels, Shorts and TikTok.
MD
cd "$tmp"
git init -q -b main
git add -A
git -c user.name="$HF_USER" -c user.email="$HF_USER@users.noreply.huggingface.co" commit -qm "Deploy Clipora"
git push -q --force "https://$HF_USER:$HF_TOKEN@huggingface.co/spaces/$HF_USER/$SPACE" main
rm -rf "$tmp"
host="$(echo "$HF_USER-$SPACE" | tr '[:upper:]_' '[:lower:]-')"
echo "Deployed: https://huggingface.co/spaces/$HF_USER/$SPACE"
echo "App URL:  https://$host.static.hf.space"
