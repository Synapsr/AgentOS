#!/bin/sh
# Rebuilds fonts/figtree.woff2, the one font of the web apps and the website,
# from the official variable font. Run it by hand when the character list
# changes; the build does not need it.
#
#   pip install fonttools brotli
#   sh scripts/subset-font.sh path/to/Figtree[wght].ttf
#
# Source: https://github.com/erikdkennedy/figtree (fonts/variable), SIL Open
# Font License 1.1, no reserved font name; the licence sits beside the font.
# Weights 300-600 only, and the characters of English and French plus
# typographic punctuation: one file of about 12 kB for every weight, served
# by the computer itself (the UI works offline). A character outside the list
# falls back to the system font.
set -eu
src=${1:?"usage: subset-font.sh Figtree[wght].ttf"}
out=$(dirname "$0")/../fonts
tmp=$(mktemp -d)

fonttools varLib.instancer "$src" wght=300:600 -q -o "$tmp/narrow.ttf"
pyftsubset "$tmp/narrow.ttf" \
  --unicodes="U+0020-007E,U+00A0,U+00A9,U+00AB,U+00B0,U+00B7,U+00BB,U+00C0,U+00C2,U+00C6-00CB,U+00CE-00CF,U+00D4,U+00D7,U+00D9,U+00DB-00DC,U+00E0,U+00E2,U+00E6-00EB,U+00EE-00EF,U+00F4,U+00F9,U+00FB-00FC,U+00FF,U+0152-0153,U+0178,U+2013-2014,U+2018-201A,U+201C-201E,U+2022,U+2026,U+2039-203A,U+20AC" \
  --layout-features="kern,liga,calt,ccmp,locl,mark,mkmk,case,tnum" \
  --flavor=woff2 \
  --output-file="$out/figtree.woff2"
rm -r "$tmp"
ls -l "$out/figtree.woff2"
