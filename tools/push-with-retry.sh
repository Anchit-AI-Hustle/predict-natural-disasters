#!/usr/bin/env bash
# Push the current commit to a branch, rebasing onto whatever landed there
# while the job ran (a merged pull request, another job's commit), up to
# three times. A real conflict stops the rebase and the job fails, loudly.
#
#   bash tools/push-with-retry.sh [branch]   (default: the current branch)
set -euo pipefail
branch="${1:-$(git rev-parse --abbrev-ref HEAD)}"
for attempt in 1 2 3; do
  if git push origin "HEAD:${branch}"; then
    exit 0
  fi
  echo "push rejected (attempt ${attempt}); rebasing onto origin/${branch}"
  git pull --rebase origin "${branch}"
done
echo "FAIL: could not push to ${branch} after 3 attempts" >&2
exit 1
