#!/usr/bin/env bash
# Redraws the images in docs/ from the made-up demo scenarios in src/panel.check.ts.
# Orca renders a scenario inside its own window, so the window must be hidden: the script
# brings Finder to the front, hides Orca, captures, then shows Orca again.
# Needs ImageMagick (`magick`) to lay out the cover and the screenshots.
set -euo pipefail
cd "$(dirname "$0")/.."

FONT=/System/Library/Fonts/SFNS.ttf
SHOTS=$(mktemp -d)
trap 'rm -r "$SHOTS"; osascript -e "tell application \"System Events\" to set visible of process \"Orca\" to true" >/dev/null' EXIT

osascript -e 'tell application "Finder" to activate' -e 'delay 0.5' \
  -e 'tell application "System Events" to set visible of process "Orca" to false' -e 'delay 1.5' >/dev/null

capture() {
  orca plugin shot . --scenario "$1" --width 440 --theme "$2" --out "$SHOTS/$3.png" >/dev/null
}
capture demo dark board-dark
capture demo light board-light
capture demoInReview dark in-review-dark
capture demoInReview light in-review-light
capture demoMerged dark merged-dark
capture demoMerged light merged-light

cp "$SHOTS/board-dark.png" docs/board-dark.png
cp "$SHOTS/board-light.png" docs/board-light.png

magick "$SHOTS/board-dark.png" -crop 440x880+0+0 +repage "$SHOTS/board-dark-cover.png"
magick -size 1600x1000 xc:'#0f1318' \
  -font "$FONT" -fill '#e6edf3' -pointsize 72 -annotate +110+330 'OpenSpec Board' \
  -fill '#7d8590' -pointsize 40 -annotate +110+395 'for Orca' \
  -fill '#c9d1d9' -pointsize 30 \
  -annotate +110+500 'Every OpenSpec change by stage,' -annotate +110+545 'with tasks, next step, ticket and PRs.' \
  -annotate +110+620 'Apply or finish it with your' -annotate +110+665 'Claude Code or Codex agent.' \
  "$SHOTS/board-dark-cover.png" -geometry +1050+60 -composite docs/cover.png

screenshot() {
  local theme=$1 background=$2 title=$3 text=$4
  magick "$SHOTS/board-$theme.png" -crop 440x760+0+0 +repage "$SHOTS/b.png"
  magick "$SHOTS/in-review-$theme.png" -resize 75% "$SHOTS/r.png"
  magick "$SHOTS/merged-$theme.png" -resize 75% "$SHOTS/m.png"
  magick -size 1280x800 xc:"$background" \
    -font "$FONT" -fill "$title" -pointsize 40 -annotate +60+120 'OpenSpec Board' \
    -fill "$text" -pointsize 24 \
    -annotate +60+175 'Stage buttons count the changes' -annotate +60+210 'and filter the board to one stage.' \
    -annotate +60+280 'A change whose pull requests are in' -annotate +60+315 'but whose tasks are open has its own' \
    -annotate +60+350 'stage, with Finish to close it out.' \
    -annotate +60+420 'Each change runs in its own Orca' -annotate +60+455 'workspace: go there, or start it.' \
    -pointsize 18 -annotate +60+760 'Demo data' \
    "$SHOTS/b.png" -geometry +470+20 -composite "$SHOTS/r.png" -geometry +930+20 -composite \
    "$SHOTS/m.png" -geometry +930+400 -composite "docs/screenshot-$theme.png"
}
screenshot dark '#0f1318' '#e6edf3' '#9da7b3'
screenshot light '#f3f4f6' '#1f2328' '#57606a'
