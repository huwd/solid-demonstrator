#!/usr/bin/env bash
# Create or update this repository's rulesets from the JSON files beside this
# script, matching each to an existing ruleset by its "name".
#
#   .github/rulesets/apply.sh             # apply every ruleset
#   .github/rulesets/apply.sh --dry-run   # show what would change, change nothing
#
# Needs the GitHub CLI signed in as a repository administrator, and jq.
# See README.md in this directory.
#
# A required status check that has never reported blocks every merge, so the
# script refuses to apply a ruleset that requires a check which hasn't yet
# reported, from GitHub Actions, on the default branch's latest commit.

set -euo pipefail

# The GitHub Actions app. Required checks are tied to it, so another app
# can't report a pass.
readonly actions_app_id=15368

dry_run=false
case "${1:-}" in
  --dry-run) dry_run=true ;;
  "") ;;
  *)
    echo "Usage: $0 [--dry-run]" >&2
    exit 2
    ;;
esac

dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
branch="$(gh api "repos/${repo}" --jq .default_branch)"
sha="$(gh api "repos/${repo}/commits/${branch}" --jq .sha)"
reported="$(gh api --paginate "repos/${repo}/commits/${sha}/check-runs" \
  --jq ".check_runs[] | select(.app.id == ${actions_app_id}) | .name" | sort -u)"

echo "Repository: ${repo}, default branch ${branch} at ${sha:0:12}"

status=0
for file in "${dir}"/*.json; do
  name="$(jq --raw-output .name "${file}")"

  missing=()
  while IFS= read -r check; do
    if ! grep --quiet --line-regexp --fixed-strings -- "${check}" <<<"${reported}"; then
      missing+=("${check}")
    fi
  done < <(jq --raw-output \
    '.rules[] | select(.type == "required_status_checks") | .parameters.required_status_checks[].context' \
    "${file}")

  if ((${#missing[@]} > 0)); then
    echo "Skipped ${name}: these required checks haven't reported on ${branch} yet:" >&2
    printf '  - %s\n' "${missing[@]}" >&2
    status=1
    continue
  fi

  id="$(gh api --paginate "repos/${repo}/rulesets" \
    --jq ".[] | select(.name == $(jq --compact-output .name "${file}")) | .id")"

  if [[ -z ${id} ]]; then
    action=(--method POST "repos/${repo}/rulesets")
    verb="Created"
  else
    action=(--method PUT "repos/${repo}/rulesets/${id}")
    verb="Updated"
  fi

  if ${dry_run}; then
    echo "Would run: gh api ${action[*]} --input ${file#"${dir}/"}"
  else
    gh api "${action[@]}" --input "${file}" >/dev/null
    echo "${verb} ${name}"
  fi
done

exit "${status}"
