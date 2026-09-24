#!/usr/bin/env bash
# PreToolUse hook (Bash): blocks anything that deploys to production or starts CI/CD.
# Owner's standing rule (2026-09-24): until they lift it, no prod deploys and no CI runs.
# Pushing to main triggers both GitHub Actions workflows (deploy-frontend/deploy-backend),
# so every `git push` is blocked, not only explicit deploy commands. Commit locally instead.

command=$(jq -r '.tool_input.command // ""')

block() {
  echo "BLOCKED by .claude/hooks/block-prod-and-ci.sh: $1" >&2
  echo "Prod deploys and CI/CD are forbidden until the owner lifts the rule. Commit locally; do not push." >&2
  exit 2
}

shopt -s nocasematch
# `git push`, `git -C dir push`, `git -c k=v push` — options between git and push, but not across ; && |
[[ $command =~ (^|[^[:alnum:]_-])git([[:space:]]+[^[:space:];\&|]+)*[[:space:]]+push([[:space:]]|$) ]] && block "git push (a push to main starts CI and deploys prod)"
[[ $command =~ convex[[:space:]]+deploy ]] && block "convex deploy"
[[ $command =~ --prod([[:space:]]|$|=) ]] && block "--prod flag"
[[ $command =~ --deployment[[:space:]=]+prod ]] && block "--deployment prod"
[[ $command =~ CONVEX_DEPLOY_KEY ]] && block "CONVEX_DEPLOY_KEY (prod deploy credential)"
[[ $command =~ clear-flamingo-97 ]] && block "the production Convex deployment"
[[ $command =~ gh[[:space:]]+(workflow[[:space:]]+(run|enable)|run[[:space:]]+rerun|pr[[:space:]]+(create|merge|ready)) ]] && block "starting a GitHub Actions run"
[[ $command =~ gh[[:space:]]+api.*(dispatches|/actions/) ]] && block "GitHub Actions API"
[[ $command =~ (swa[[:space:]]+deploy|az[[:space:]]+staticwebapp) ]] && block "Azure Static Web Apps deploy"
[[ $command =~ rotate-ci-deploy-key ]] && block "CI deploy-key rotation"
exit 0
