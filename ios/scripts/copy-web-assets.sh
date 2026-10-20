#!/bin/sh
# Copies the site's own files into the app bundle at build time, so the app
# grades forecasts and lists past disasters with exactly the code and data
# the website uses. Nothing here is a copy kept in the repository.
set -eu
ROOT="${SRCROOT}/.."
DEST="${TARGET_BUILD_DIR}/${UNLOCALIZED_RESOURCES_FOLDER_PATH}/Web"
mkdir -p "$DEST"
for f in hazard-model.js observed-model.js verification-model.js verdicts.js history-data.js world-countries.json; do
  if [ ! -f "$ROOT/$f" ]; then
    echo "error: $ROOT/$f is missing; the app needs the site's own copy" >&2
    exit 1
  fi
  cp "$ROOT/$f" "$DEST/$f"
done
