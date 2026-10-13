#!/usr/bin/env bash
# Builds a signed Clipora APK without Gradle (just the Android SDK tools).
# Usage: android/build.sh   → android/out/Clipora.apk
set -euo pipefail
cd "$(dirname "$0")"
SDK="${ANDROID_HOME:-$HOME/Android/Sdk}"
BT="$SDK/build-tools/$(ls "$SDK/build-tools" | sort -V | tail -1)"
JAR="$SDK/platforms/android-35/android.jar"
JDK="${JAVA_HOME:-$HOME/.local/jdk21}"
export PATH="$JDK/bin:$PATH"
B=build; OUT=out
rm -rf "$B"; mkdir -p "$B"/{res-flat,gen,classes,assets/www,res} "$OUT"

# 1. Web app → assets/www (everything except tests, dev and Android files)
cp -r ../index.html ../css ../js ../icons ../logo.svg ../manifest.webmanifest "$B/assets/www/"

# 2. Resources: theme + launcher icons (legacy + adaptive)
cp -r res/* "$B/res/"
python3 - "$B/res" <<'PY'
import sys, os
from PIL import Image
res = sys.argv[1]
icon = Image.open('../icons/icon-512.png').convert('RGBA')
mask = Image.open('../icons/maskable-512.png').convert('RGBA')
for d, px in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
    os.makedirs(f'{res}/mipmap-{d}', exist_ok=True)
    icon.resize((px, px), Image.LANCZOS).save(f'{res}/mipmap-{d}/ic_launcher.png')
    fg = round(px * 108 / 48)
    mask.resize((fg, fg), Image.LANCZOS).save(f'{res}/mipmap-{d}/ic_launcher_fg.png')
os.makedirs(f'{res}/mipmap-anydpi-v26', exist_ok=True)
open(f'{res}/mipmap-anydpi-v26/ic_launcher.xml', 'w').write('''<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/bg"/>
    <foreground android:drawable="@mipmap/ic_launcher_fg"/>
</adaptive-icon>''')
PY
"$BT/aapt2" compile --dir "$B/res" -o "$B/res-flat/res.zip"
"$BT/aapt2" link -o "$B/base.apk" -I "$JAR" --manifest AndroidManifest.xml \
  -A "$B/assets" --java "$B/gen" "$B/res-flat/res.zip" \
  --min-sdk-version 26 --target-sdk-version 35 -0 mp4

# 3. Java → dex
javac -source 17 -target 17 -Xlint:-options -encoding UTF-8 -classpath "$JAR" -d "$B/classes" \
  $(find src "$B/gen" -name '*.java')
"$BT/d8" --release --lib "$JAR" --min-api 26 --output "$B" $(find "$B/classes" -name '*.class')
(cd "$B" && zip -q -j base.apk classes.dex)

# 4. Align + sign (keystore is created once; KEEP IT SAFE, Play Store updates need the same key)
KS="${KEYSTORE:-keystore/clipora-release.jks}"
if [ ! -f "$KS" ]; then
  mkdir -p "$(dirname "$KS")"
  PASS="$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9')"
  keytool -genkeypair -keystore "$KS" -alias clipora -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$PASS" -keypass "$PASS" -dname "CN=Clipora, O=Clipora, C=BD" >/dev/null 2>&1
  echo "$PASS" > "$(dirname "$KS")/password.txt"
  chmod 600 "$KS" "$(dirname "$KS")/password.txt"
  echo "Created signing key $KS (password in $(dirname "$KS")/password.txt)"
fi
PASS="${KEYSTORE_PASS:-$(cat "$(dirname "$KS")/password.txt")}"
"$BT/zipalign" -f -p 4 "$B/base.apk" "$B/aligned.apk"
"$BT/apksigner" sign --ks "$KS" --ks-key-alias clipora --ks-pass "pass:$PASS" --key-pass "pass:$PASS" \
  --out "$OUT/Clipora.apk" "$B/aligned.apk"
"$BT/apksigner" verify "$OUT/Clipora.apk"
ls -lh "$OUT/Clipora.apk"
