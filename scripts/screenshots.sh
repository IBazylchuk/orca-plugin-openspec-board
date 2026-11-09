#!/usr/bin/env bash
# Redraws docs/*.png from the demo scenarios in src/panel.check.ts.
# Orca renders a scenario inside its own window, so hide Orca (Cmd+H) during the countdown.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "Hide the Orca window now; capturing in 5 seconds."
sleep 5
shoot() {
  orca plugin shot . --scenario "$1" --width 440 --theme "$2" --out "docs/$3.png"
}
shoot demo dark board-dark
shoot demo light board-light
shoot demoInReview dark in-review-dark
shoot demoMerged light merged-light
