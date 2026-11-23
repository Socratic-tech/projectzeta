#!/usr/bin/env bash
# Publish a branch to the PREVIEW site for end-user testing:
#   https://socratic-tech.github.io/projectzeta-preview/
#
# Usage:  tools/deploy-preview.sh [branch-or-commit]   (default: current HEAD)
#
# How it works: checks out the given commit in a throwaway worktree, flips
# VT_ENV from "" to "PREVIEW" in every page (namespaced storage + orange
# "test data only" banner), commits that, and force-pushes it to the
# projectzeta-preview repo's main branch. The VT_ENV flip never lands on any
# branch here, so merging your work into main for the live site needs no cleanup.
#
# Only committed work is published. Uncommitted edits are not included.
set -euo pipefail

PREVIEW_REMOTE_URL="https://github.com/Socratic-tech/projectzeta-preview.git"
PREVIEW_SITE="https://socratic-tech.github.io/projectzeta-preview/"

cd "$(git rev-parse --show-toplevel)"
SRC="${1:-HEAD}"
SHA="$(git rev-parse --short "$SRC^{commit}")"
LABEL="$(git rev-parse --abbrev-ref "$SRC" 2>/dev/null || echo "$SRC")"

if [ "$SRC" = "HEAD" ] && [ -n "$(git status --porcelain)" ]; then
  echo "Note: you have uncommitted changes; they will NOT be in the preview."
fi

TMP="$(mktemp -d)"
cleanup() { git worktree remove --force "$TMP" >/dev/null 2>&1 || rm -rf "$TMP"; }
trap cleanup EXIT

git worktree add --quiet --detach "$TMP" "$SRC"
cd "$TMP"

perl -pi -e 's/const VT_ENV = "";/const VT_ENV = "PREVIEW";/' ./*.html

# Every page that defines VT_ENV must now be PREVIEW; otherwise stop, so a
# page can't share storage with the live site.
MISSED="$(grep -L 'const VT_ENV = "PREVIEW";' $(grep -l 'const VT_ENV' ./*.html) || true)"
if [ -n "$MISSED" ]; then
  echo "Stopped: VT_ENV was not switched to PREVIEW in:" >&2
  echo "$MISSED" >&2
  exit 1
fi

git -c user.name="preview-bot" -c user.email="preview-bot@users.noreply.github.com" \
  commit --quiet -am "Preview build of $LABEL @ $SHA"
git push --quiet --force "$PREVIEW_REMOTE_URL" HEAD:refs/heads/main

echo "Published $LABEL @ $SHA to the preview site:"
echo "  $PREVIEW_SITE"
echo "(GitHub Pages takes about a minute to update.)"
