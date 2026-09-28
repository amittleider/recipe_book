#!/usr/bin/env bash
# Turn a photo into an OCR fixture the test suite can replay.
#
#   scripts/ocr/fixture.sh ~/Desktop/page.jpg salade-haricots-avocat
#
# Requires macOS with Xcode command line tools. The binary is built once into
# the script's own directory and reused; it is gitignored.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"

[ $# -ge 1 ] || { echo "usage: $0 <image> [fixture-name] [lang...]" >&2; exit 1; }
image="$1"; name="${2:-$(basename "${1%.*}")}"; shift 2 2>/dev/null || shift 1
langs=("$@"); [ ${#langs[@]} -gt 0 ] || langs=(fr-FR en-US)

if [ ! -x "$here/VisionOcr" ] || [ "$here/VisionOcr.swift" -nt "$here/VisionOcr" ]; then
  echo "building VisionOcr…" >&2
  swiftc -O "$here/VisionOcr.swift" -o "$here/VisionOcr"
fi

out="$root/src/import/image/fixtures/$name.json"
"$here/VisionOcr" "$image" "${langs[@]}" > "$out"
echo "wrote ${out#"$root"/} ($(grep -c '"text"' "$out") lines)"
