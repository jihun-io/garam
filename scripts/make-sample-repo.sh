#!/usr/bin/env bash
# Builds a sample repository (plus a bare "remote") for manually testing Garam.
# Usage: scripts/make-sample-repo.sh [parent-dir]  (defaults to the folder containing this repo)
# macOS only: relies on BSD `date -j` and `sed -i ''`.
set -euo pipefail

BASE="${1:-$(cd "$(dirname "$0")/../.." && pwd)}"
REPO="$BASE/garam-sample-repo"
REMOTE="$BASE/garam-sample-remote.git"

if [ -e "$REPO" ] || [ -e "$REMOTE" ]; then
  echo "refusing: $REPO or $REMOTE already exists" >&2
  exit 1
fi

export GIT_CONFIG_NOSYSTEM=1
DAY=0
START=$(date -j -f "%Y-%m-%d %H:%M:%S" "2026-06-01 09:00:00" +%s)

who() { # name email
  export GIT_AUTHOR_NAME="$1" GIT_AUTHOR_EMAIL="$2"
  export GIT_COMMITTER_NAME="$1" GIT_COMMITTER_EMAIL="$2"
}
tick() { # advance the fake clock by N hours (default 7)
  DAY=$((DAY + ${1:-7} * 3600))
  local ts=$((START + DAY))
  export GIT_AUTHOR_DATE="@$ts +0900" GIT_COMMITTER_DATE="@$ts +0900"
}
c() { # commit everything with message (extra args become body paragraphs)
  tick
  git add -A
  local args=(-q -m "$1"); shift
  for p in "$@"; do args+=(-m "$p"); done
  git commit "${args[@]}"
}
merge() { # merge --no-ff with a message
  tick 3
  git merge -q --no-ff "$1" -m "${2:-Merge branch '$1'}"
}

ALICE=("Alice Park" "alice@example.com")
BOB=("Bob Lee" "bob@example.com")
JIHUN=("김지훈" "jihun@example.com")
CAROL=("Carol Chen" "carol@example.com")

git init -q -b main "$REPO"
cd "$REPO"
git config user.name "${JIHUN[0]}"
git config user.email "${JIHUN[1]}"

# --- main: project bootstrap -------------------------------------------------
who "${JIHUN[@]}"
cat > README.md <<'EOF'
# Todo Garden

A tiny todo app used as a sample repository.
EOF
c "Initial commit"

mkdir -p src tests
cat > src/app.js <<'EOF'
const todos = [];

function addTodo(title) {
  todos.push({ title, done: false });
}

module.exports = { addTodo, todos };
EOF
cat > package.json <<'EOF'
{
  "name": "todo-garden",
  "version": "0.1.0",
  "main": "src/app.js"
}
EOF
printf 'node_modules/\n.env\n*.log\n' > .gitignore
c "feat: add basic todo store"

who "${ALICE[@]}"
cat > tests/app.test.js <<'EOF'
const { addTodo, todos } = require('../src/app');

addTodo('water the plants');
console.assert(todos.length === 1);
EOF
c "test: cover addTodo" "Adds a first smoke test so CI has something to run."

tick 2
git tag -a v0.1.0 -m "First preview release"

# --- develop line --------------------------------------------------------------
git branch develop

# feature/auth: multi-commit feature merged with --no-ff
git switch -q -c feature/auth
who "${BOB[@]}"
cat > src/auth.js <<'EOF'
function login(user, password) {
  return user === 'admin' && password.length > 0;
}

module.exports = { login };
EOF
c "feat(auth): add login stub"
sed -i '' 's/password.length > 0/password.length >= 8/' src/auth.js
c "fix(auth): require 8+ character passwords"
cat >> src/auth.js <<'EOF'

function logout() {
  return true;
}

module.exports.logout = logout;
EOF
c "feat(auth): add logout"

# feature/dark-mode in parallel, from develop
git switch -q develop
git switch -q -c feature/dark-mode
who "${CAROL[@]}"
mkdir -p styles
cat > styles/theme.css <<'EOF'
:root {
  --bg: #ffffff;
  --fg: #1d1d1f;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1d1d1f;
    --fg: #f5f5f7;
  }
}
EOF
c "feat(ui): add dark mode tokens 🌙"
sed -i '' 's/#1d1d1f;$/#111111;/' styles/theme.css
c "style: deepen dark background"

git switch -q develop
who "${JIHUN[@]}"
merge feature/auth "Merge branch 'feature/auth' into develop"
merge feature/dark-mode "Merge branch 'feature/dark-mode' into develop"

who "${JIHUN[@]}"
cat >> README.md <<'EOF'

## 기능

- 할 일 추가
- 로그인 / 로그아웃
- 다크 모드
EOF
c "docs: 한국어 기능 목록 추가" "README에 현재 기능을 정리했다." "Refs: #12"

# --- release to main -------------------------------------------------------
git switch -q main
merge develop "Merge branch 'develop' for 0.2.0"
sed -i '' 's/"0.1.0"/"0.2.0"/' package.json
c "chore(release): 0.2.0"
git tag v0.2.0   # lightweight tag

# hotfix fast-forwarded into main
git switch -q -c hotfix/typo
who "${ALICE[@]}"
sed -i '' 's/A tiny todo app/A tiny todo application/' README.md
c "fix: typo in README"
git switch -q main
git merge -q --ff-only hotfix/typo
git branch -q -d hotfix/typo

# --- file operations: rename, delete, binary, mode change, big file ----------
who "${BOB[@]}"
git mv src/app.js src/store.js
sed -i '' "s#'../src/app'#'../src/store'#" tests/app.test.js
c "refactor: rename app.js to store.js"

mkdir -p assets scripts
# 1x1 PNG
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\xcf\xc0\xf0\x1f\x00\x05\x00\x01\xff\x89\x99=\x1d\x00\x00\x00\x00IEND\xaeB`\x82' > assets/logo.png
c "chore: add logo"

printf '#!/bin/sh\necho "building..."\n' > scripts/build.sh
c "build: add build script"
chmod +x scripts/build.sh
c "build: make build script executable"

who "${CAROL[@]}"
for i in $(seq 1 400); do echo "line $i: lorem ipsum dolor sit amet, consectetur adipiscing elit"; done > docs.txt
c "docs: add long reference text"
awk 'NR % 37 == 0 { print "line " NR ": EDITED"; next } { print }' docs.txt > docs.tmp && mv docs.tmp docs.txt
c "docs: scatter edits through reference text" "Touches many hunks so the diff view has something to scroll."

git rm -q styles/theme.css 2>/dev/null || true
mkdir -p styles
cat > styles/tokens.css <<'EOF'
:root { --accent: #2f6f4e; }
EOF
c "refactor(ui): replace theme.css with tokens.css"

mkdir -p "docs/한글 폴더"
echo "파일 이름과 경로에 공백·한글이 있는 경우" > "docs/한글 폴더/메모 파일.md"
c "docs: add file with unicode and spaces in path"

who "${JIHUN[@]}"
c_long_subject="feat: this is an intentionally very long commit subject line that keeps going well past the usual seventy-two character limit"
echo "export const LIMIT = 100;" > src/limits.js
c "$c_long_subject"

tick 4
git tag -a v1.0.0 -m "1.0.0" -m "Stable release with auth and dark mode."
git branch release/1.0

# --- unmerged branches ------------------------------------------------------
# feature/search: ahead of main by a few commits
git switch -q -c feature/search
who "${ALICE[@]}"
cat > src/search.js <<'EOF'
function search(todos, q) {
  return todos.filter((t) => t.title.includes(q));
}

module.exports = { search };
EOF
c "feat(search): naive substring search"
sed -i '' 's/t.title.includes(q)/t.title.toLowerCase().includes(q.toLowerCase())/' src/search.js
c "feat(search): case-insensitive matching"
echo "// TODO: fuzzy" >> src/search.js
c "WIP: fuzzy search"

# release/1.0 gets a patch that must also go to main (cherry-pick candidate)
git switch -q release/1.0
who "${BOB[@]}"
sed -i '' 's/>= 8/>= 10/' src/auth.js
c "fix(auth): raise minimum password length to 10" "Security review finding." "Cc: security@example.com"
tick 1
git tag -a v1.0.1 -m "1.0.1"

# experiment/rewrite: long-lived, heavily diverged, branched from v0.1.0
git switch -q -c experiment/rewrite v0.1.0
who "${CAROL[@]}"
cat > src/app.ts <<'EOF'
export interface Todo {
  title: string;
  done: boolean;
}

export const todos: Todo[] = [];
EOF
git rm -q src/app.js
c "experiment: port store to TypeScript"
echo '{ "compilerOptions": { "strict": true } }' > tsconfig.json
c "experiment: add tsconfig"
cat >> src/app.ts <<'EOF'

export function addTodo(title: string): void {
  todos.push({ title, done: false });
}
EOF
c "experiment: typed addTodo"

# conflict/readme: edits the same README lines as main -> guaranteed conflict
git switch -q -c conflict/readme v1.0.0
who "${BOB[@]}"
sed -i '' 's/A tiny todo application used as a sample repository./A delightful todo app for gardeners. 🌱/' README.md
sed -i '' 's/- 다크 모드/- 다크 모드 (자동 전환)/' README.md
c "docs: rewrite README tagline"
sed -i '' 's/"0.2.0"/"1.1.0-beta"/' package.json
c "chore: bump version to 1.1.0-beta"

# --- main moves on (creates conflicts with conflict/readme) ----------------
git switch -q main
who "${JIHUN[@]}"
sed -i '' 's/A tiny todo application used as a sample repository./Todo Garden keeps your tasks tidy./' README.md
sed -i '' 's/- 다크 모드/- 다크 모드 및 라이트 모드/' README.md
c "docs: new tagline"
sed -i '' 's/"0.2.0"/"1.0.0"/' package.json
c "chore: sync package version with tag"

# merge with a real conflict resolved by hand, so history has a resolved merge
git switch -q -c feature/greeting
who "${ALICE[@]}"
echo "module.exports = () => 'Hello, garden!';" > src/greeting.js
c "feat: greeting (English)"
git switch -q main
who "${CAROL[@]}"
echo "module.exports = () => '안녕하세요, 정원!';" > src/greeting.js
c "feat: greeting (Korean)"
tick 2
git merge -q feature/greeting -m "Merge branch 'feature/greeting'" || true
cat > src/greeting.js <<'EOF'
const messages = { en: 'Hello, garden!', ko: '안녕하세요, 정원!' };
module.exports = (lang = 'en') => messages[lang];
EOF
git add src/greeting.js
git commit -q --no-edit
git branch -q -d feature/greeting

# nested branch names
git branch -q bugfix/ui/button-alignment HEAD~2
git branch -q user/jihun/scratch v0.2.0

# --- remote ------------------------------------------------------------------
git init -q --bare -b main "$REMOTE"
git remote add origin "$REMOTE"
git push -q origin main develop release/1.0 feature/search experiment/rewrite --tags
git branch -q -u origin/main main
git branch -q -u origin/develop develop
git branch -q -u origin/release/1.0 release/1.0
git branch -q -u origin/feature/search feature/search
git branch -q -u origin/experiment/rewrite experiment/rewrite

# someone else pushes to main and feature/search -> local is behind
TMP=$(mktemp -d)
git clone -q "$REMOTE" "$TMP/other"
(
  cd "$TMP/other"
  who "${BOB[@]}"
  tick 5
  echo "- 검색 (준비 중)" >> README.md
  git commit -qam "docs: mention upcoming search"
  git push -q origin main
  git switch -q feature/search
  who "${ALICE[@]}"
  tick 1
  echo "// reviewed" >> src/search.js
  git commit -qam "chore(search): address review comment"
  git push -q origin feature/search
  # a branch that exists only on the remote
  git switch -q -c feature/remote-only main
  tick 1
  echo "remote only" > REMOTE_ONLY.md
  git add REMOTE_ONLY.md
  git commit -qm "feat: something pushed from another machine"
  git push -q origin feature/remote-only
)
rm -rf "$TMP"
git fetch -q origin

# local main gets its own unpushed commit -> diverged (ahead 1, behind 1)
who "${JIHUN[@]}"
echo "export const PAGE_SIZE = 20;" >> src/limits.js
c "feat: add page size limit"

# --- stashes -----------------------------------------------------------------
echo "// stash me" >> src/store.js
tick 1
git stash push -q -m "half-done store refactor"
echo "--accent2: #ff8800;" >> styles/tokens.css
echo "temp" > stash-untracked.txt
tick 1
git stash push -q -u -m "experiment with second accent (with untracked)"

# --- dirty working tree ------------------------------------------------------
# staged only
echo "export const MAX_TAGS = 5;" >> src/limits.js
git add src/limits.js
# partially staged: one hunk staged, another unstaged
printf '// header comment\n' | cat - src/auth.js > auth.tmp && mv auth.tmp src/auth.js
git add src/auth.js
echo "// footer comment" >> src/auth.js
# unstaged modification
sed -i '' 's/line 100:/line 100 (changed):/' docs.txt
# deleted
rm scripts/build.sh
# untracked
echo "notes to self" > NOTES.md
mkdir -p tmp && echo "scratch" > tmp/scratch.txt
# ignored
echo "SECRET=not-a-real-secret" > .env

echo
echo "Created $REPO (remote: $REMOTE)"
