#!/bin/sh
# Exports every screenshot attached by the UI tests as a PNG.
# Usage: export-screenshots.sh OUT_DIR RESULT.xcresult [RESULT.xcresult ...]
set -u
OUT="$1"; shift
mkdir -p "$OUT"
for R in "$@"; do
  [ -d "$R" ] || { echo "skip: $R not found"; continue; }
  NAME=$(basename "$R" .xcresult)
  mkdir -p "$OUT/$NAME"
  # Xcode 16 and later.
  if xcrun xcresulttool export attachments --path "$R" --output-path "$OUT/$NAME" 2>/dev/null; then
    # Name the files after the attachment names recorded in the manifest.
    if [ -f "$OUT/$NAME/manifest.json" ]; then
      python3 - "$OUT/$NAME" <<'PY'
import json, os, sys
d = sys.argv[1]
for test in json.load(open(os.path.join(d, "manifest.json"))):
    for a in test.get("attachments", []):
        src = os.path.join(d, a.get("exportedFileName", ""))
        name = a.get("suggestedHumanReadableName") or a.get("name") or ""
        if os.path.isfile(src) and name:
            base = "".join(c if c.isalnum() or c in "-_." else "_" for c in name)
            if not base.lower().endswith(".png"):
                base += ".png"
            os.replace(src, os.path.join(d, base))
PY
    fi
  else
    echo "xcresulttool export attachments is not available; screenshots stay inside $R"
  fi
done
find "$OUT" -name '*.png' | sort | head -200
