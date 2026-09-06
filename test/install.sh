#!/bin/bash
# README に書いた導入手順が実際に通ることを確かめる。
#
# 公開前でも試せるよう、GitHub を見に行かず、いまの作業木の複製を参照先にする。
# 参照の形（git+file://…#タグ）は github: の短縮形と同じ経路を通るため、
# files の効き方、bin のリンク、依存の巻き取りはここで確かめられる。

set -u

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

pass=0
fail=0

check() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    printf 'OK   %s\n' "$name"
    pass=$((pass + 1))
  else
    printf 'NG   %s（期待 %s / 実際 %s）\n' "$name" "$expected" "$actual"
    fail=$((fail + 1))
  fi
}

# ---- 参照先のリポジトリを作る

mkdir -p "$work/src"
tar -c --exclude=node_modules --exclude=.git -C "$root" . | tar -x -C "$work/src"
(
  cd "$work/src" || exit 1
  git init -q
  git add -A
  git -c user.email=test@example.com -c user.name=test commit -qm "検証"
  git tag v0.0.0-test
) || { echo "参照先のリポジトリを作れなかった" >&2; exit 2; }
git clone --bare -q "$work/src" "$work/repo.git"

# ---- 利用側を作る。README の「既存のプロジェクトに足す」をそのまま写す

consumer="$work/consumer"
mkdir -p "$consumer/docs" "$consumer/src/ui"
cd "$consumer" || exit 2

cat > package.json <<JSON
{
  "name": "install-check",
  "version": "1.0.0",
  "private": true,
  "devDependencies": {
    "@223n/lint-config-ja": "git+file://$work/repo.git#v0.0.0-test",
    "markdownlint-cli2": "^0.23.2",
    "textlint": "^15.8.0"
  }
}
JSON

cat > .textlintrc.js <<'JS'
module.exports = require('@223n/lint-config-ja/config/textlint.js')
JS

cat > .markdownlint-cli2.jsonc <<'JSONC'
{
  "config": {
    "extends": "@223n/lint-config-ja/config/markdownlint.jsonc"
  },
  "globs": ["**/*.md"],
  "ignores": ["node_modules/**"]
}
JSONC

printf 'node_modules/**\n' > .textlintignore

cat > lint-vocabulary.config.json <<'JSON'
{
  "targets": [
    {
      "path": "src/ui",
      "extensions": [".ts"],
      "rules": [
        {
          "code": "LINT001",
          "pattern": "new Date\\(",
          "message": "日付の生成は中核層に置く。"
        }
      ]
    }
  ]
}
JSON

printf '# 見出し\n\nこれは利用側の文書である。\n' > docs/a.md

npm install --no-audit --no-fund > "$work/install.log" 2>&1
code=$?
check "git参照で入る" 0 $code
if [ "$code" -ne 0 ]; then
  echo "--- npm install の出力 ---"
  cat "$work/install.log"
  echo "--------------------------"
fi

# ---- 入ったものを確かめる

[ -f node_modules/@223n/lint-config-ja/config/textlint.js ]
check "textlintの設定が入る" 0 $?

[ -f node_modules/@223n/lint-config-ja/config/markdownlint.jsonc ]
check "markdownlintの設定が入る" 0 $?

[ -x node_modules/.bin/lint-vocabulary ] || [ -e node_modules/.bin/lint-vocabulary ]
check "語彙検査がbinにつながる" 0 $?

# files に書いていないものは入らない
[ ! -d node_modules/@223n/lint-config-ja/example ]
check "見本は配布物に入らない" 0 $?

[ ! -d node_modules/@223n/lint-config-ja/test ]
check "検証は配布物に入らない" 0 $?

# ---- 3つの検査を動かす

./node_modules/.bin/textlint . >/dev/null 2>&1
check "textlintが通る" 0 $?

./node_modules/.bin/markdownlint-cli2 >/dev/null 2>&1
check "markdownlintが通る" 0 $?

# 配った設定が効いていることを、切った規則と生きている規則の両方で見る。
# 肯定側だけだと、規則を全部外しても通ってしまう。

# MD013 は配った設定で切ってある。効いていれば長い行が通る
{
  printf '# 見出し\n\n'
  awk 'BEGIN { printf "word "; for (i = 0; i < 60; i++) printf "word "; print "end." }'
} > docs/long.md
./node_modules/.bin/markdownlint-cli2 >/dev/null 2>&1
check "配った設定が効いている（MD013が切れている）" 0 $?
rm -f docs/long.md

# MD047 は既定のまま生きている。ファイルの末尾は改行1つで終える。
# 日本語の文中ではアンダースコアが強調にならないため、MD049 ではなくこちらで見る
printf '# 見出し\n\n末尾に改行が無い文である。' > docs/nonewline.md
./node_modules/.bin/markdownlint-cli2 >/dev/null 2>&1
check "生きている規則は落とす（MD047）" 1 $?
rm -f docs/nonewline.md

printf 'export const x = 1\n' > src/ui/a.ts
./node_modules/.bin/lint-vocabulary >/dev/null 2>&1
check "語彙検査が通る" 0 $?

printf 'export const x = new Date()\n' > src/ui/a.ts
./node_modules/.bin/lint-vocabulary >/dev/null 2>&1
check "語彙検査が違反を捕まえる" 1 $?

printf '// 検査除外: 表示に使うだけである\nexport const x = new Date()\n' > src/ui/a.ts
./node_modules/.bin/lint-vocabulary >/dev/null 2>&1
check "断りがあれば見逃す" 0 $?

# ---- 配った既定値が効いていることを、境目の両側で見る

cat > .textlintrc.js <<'JS'
module.exports = require('@223n/lint-config-ja/config/textlint.js')
JS

# sentence-length は 120 にしてある。
# 116 文字の文は通る。preset の既定（100）のままなら落ちる。
# 同じ字を並べると別の規則（同語反復）に当たるため、自然な文で見る
cat > docs/a.md <<'MD'
# 見出し

この共有設定は日本語の技術文書を検査するためのものであり、文体の統一や一文の長さ、助詞の連続といった書き方の癖を機械的に見つけ、読み手に負担をかける表現を減らし、書き手が迷わずに書き進められるようにすることを目的として作られている。
MD
./node_modules/.bin/textlint . >/dev/null 2>&1
check "sentence-length が 120 に緩めてある（116文字は通る）" 0 $?

# 125 文字なら落ちる。切ってあるわけではないことを見る
cat > docs/a.md <<'MD'
# 見出し

この共有設定は日本語の技術文書を検査するためのものであり、文体の統一や一文の長さ、助詞の連続といった書き方の癖を機械的に見つけ、読み手に負担をかける表現を減らし、書き手が迷わずに書き進められるようにすることを目的として作られたものであると説明できる。
MD
./node_modules/.bin/textlint . >/dev/null 2>&1
check "sentence-length は切ってはいない（125文字は落ちる）" 1 $?

# ---- ですます調に切り替えられる

cat > .textlintrc.js <<'JS'
module.exports = require('@223n/lint-config-ja/config/textlint-desumasu.js')
JS
printf '# 見出し\n\nこれは利用側の文書です。\n' > docs/a.md
./node_modules/.bin/textlint . >/dev/null 2>&1
check "ですます調に切り替えられる" 0 $?

printf '# 見出し\n\nこれは利用側の文書である。\n' > docs/a.md
./node_modules/.bin/textlint . >/dev/null 2>&1
check "ですます調のとき、である調は指摘される" 1 $?

# ---- 全角と半角の間のスペースを切り替えられる

cat > .textlintrc.js <<'JS'
const { createTextlintConfig } = require('@223n/lint-config-ja/config/textlint-base.js')
module.exports = createTextlintConfig({ halfWidthSpacing: 'always' })
JS
printf '# 見出し\n\nこれは JavaScript の文である。\n' > docs/a.md
./node_modules/.bin/textlint . >/dev/null 2>&1
check "halfWidthSpacing always でスペースありが通る" 0 $?

printf '# 見出し\n\nこれはJavaScriptの文である。\n' > docs/a.md
./node_modules/.bin/textlint . >/dev/null 2>&1
check "halfWidthSpacing always でスペースなしが落ちる" 1 $?

# ---- jtf-style を丸ごと外せる

cat > .textlintrc.js <<'JS'
const { createTextlintConfig } = require('@223n/lint-config-ja/config/textlint-base.js')
module.exports = createTextlintConfig({ jtfStyle: false, halfWidthSpacing: false })
JS
printf '# 見出し\n\nこれは JavaScript の文である。\n' > docs/a.md
./node_modules/.bin/textlint . >/dev/null 2>&1
check "jtfStyle false と halfWidthSpacing false で通る" 0 $?

printf '\n通過 %s / 失敗 %s\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
