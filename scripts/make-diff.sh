#!/usr/bin/env bash
set -euo pipefail

# ------------------------------------------------------------------------------
# make-diff.sh — строит unified diff и пишет его в указанный файл
# По умолчанию: сначала пытаемся взять локальные изменения (staged/unstaged) vs HEAD,
# если пусто — считаем коммитный diff BASE..HEAD (BASE из upstream или origin/<default>).
#
# Опции:
#   --out <file>     путь для вывода (default: .sentinel/reviews/changes.diff)
#   --base <rev>     вместо автоопределения BASE
#   --head <rev>     default: HEAD
#   --mode <auto|local|commit>  стратегия (default: auto)
#   --context <N>    -U<N> для git diff (default: 0)
#
# Примеры:
#   scripts/make-diff.sh
#   scripts/make-diff.sh --out .sentinel/reviews/my.diff
#   scripts/make-diff.sh --mode commit --base origin/main --head HEAD
# ------------------------------------------------------------------------------

OUT=".sentinel/reviews/changes.diff"
BASE=""
HEAD="HEAD"
MODE="auto"      # auto|local|commit
CTX="0"

# --- parse args ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --out)     OUT="$2"; shift 2;;
    --base)    BASE="$2"; shift 2;;
    --head)    HEAD="$2"; shift 2;;
    --mode)    MODE="$2"; shift 2;;
    --context) CTX="$2"; shift 2;;
    -h|--help)
      grep -E '^# ' "$0" | sed 's/^# \{0,1\}//'
      exit 0;;
    *) echo "Unknown arg: $1" >&2; exit 2;;
  esac
done

mkdir -p "$(dirname "$OUT")"

# small helpers
_have_upstream() {
  git rev-parse --abbrev-ref --symbolic-full-name @{u} >/dev/null 2>&1
}
_default_branch() {
  # пытаемся прочитать origin/HEAD → имя default-ветки, иначе main
  local d
  d="$(git symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null || true)"
  if [[ -n "$d" ]]; then
    echo "${d##refs/remotes/origin/}"
  else
    echo "main"
  fi
}

# 1) local mode: включить staged+unstaged против HEAD
local_diff() {
  git diff --no-color -U"$CTX" HEAD > "$OUT" || true
  [[ -s "$OUT" ]]
}

# 2) commit mode: BASE..HEAD
commit_diff() {
  local base="$1" head="$2"
  git diff --no-color -U"$CTX" "$base..$head" > "$OUT" || true
  [[ -s "$OUT" ]]
}

# resolve BASE if empty
resolve_base() {
  if [[ -n "$BASE" ]]; then
    echo "$BASE"; return
  fi
  if _have_upstream; then
    local upstream; upstream="$(git rev-parse --abbrev-ref --symbolic-full-name @{u})"
    git merge-base "$upstream" "$HEAD"
    return
  fi
  local def; def="$(_default_branch)"
  git fetch --quiet origin "$def" --depth=1 || true
  if git rev-parse --verify --quiet "origin/$def" >/dev/null; then
    git merge-base "origin/$def" "$HEAD"
    return
  fi
  # fallback: предыдущий коммит
  git rev-parse "${HEAD}~1" 2>/dev/null || echo "$HEAD"
}

# --- main ---
case "$MODE" in
  local)
    if local_diff; then
      echo "local-diff:ok → $OUT"
      exit 0
    else
      echo "local-diff:empty → $OUT"
      exit 0
    fi
    ;;
  commit)
    base="$(resolve_base)"
    if commit_diff "$base" "$HEAD"; then
      echo "commit-diff:ok ($base..$HEAD) → $OUT"
      exit 0
    else
      echo "commit-diff:empty ($base..$HEAD) → $OUT"
      exit 0
    fi
    ;;
  auto)
    if local_diff; then
      echo "local-diff:ok → $OUT"
      exit 0
    fi
    base="$(resolve_base)"
    if commit_diff "$base" "$HEAD"; then
      echo "commit-diff:ok ($base..$HEAD) → $OUT"
      exit 0
    fi
    echo "diff:empty → $OUT"
    exit 0
    ;;
  *)
    echo "Unknown --mode: $MODE" >&2; exit 2;;
esac
