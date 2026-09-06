#!/bin/bash
# 語彙検査 CLI の検証。元の lint-layer.sh が壊れるケースも含める。
set -u
CLI="$(cd "$(dirname "$0")/.." && pwd)/bin/lint-vocabulary.mjs"
BASE="$(cd "$(dirname "$0")" && pwd)"
WORK="$BASE/work"
pass=0
fail=0

check() {
  local name="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    printf 'OK   %-46s (exit %s)\n' "$name" "$actual"
    pass=$((pass + 1))
  else
    printf 'NG   %-46s (期待 %s / 実際 %s)\n' "$name" "$expected" "$actual"
    fail=$((fail + 1))
  fi
}

rm -rf "$WORK"
mkdir -p "$WORK/src/ui" "$WORK/src/core" "$WORK/src/gen"

cat > "$WORK/lint-vocabulary.config.json" <<'JSON'
{
  "allowMarker": "検査除外",
  "targets": [
    {
      "name": "画面",
      "path": "src/ui",
      "extensions": [".ts"],
      "exclude": ["**/*.test.ts", "gen/**"],
      "rules": [
        { "code": "LINT001", "pattern": "\\bnew Date\\(", "message": "日付の生成は中核に置く。" },
        { "code": "LINT002", "pattern": "\\.reduce\\(", "message": "集計は中核に置く。" }
      ]
    }
  ]
}
JSON

# --- 1. 違反あり
cat > "$WORK/src/ui/a.ts" <<'TS'
const now = new Date()
TS
( cd "$WORK" && node "$CLI" >/dev/null 2>&1 ); check "違反があれば 1 で落ちる" 1 $?

# --- 2. 同じ行の断り
cat > "$WORK/src/ui/a.ts" <<'TS'
const now = new Date() // 検査除外: 表示する時計に使うだけである
TS
( cd "$WORK" && node "$CLI" >/dev/null 2>&1 ); check "同じ行の断りで見逃す" 0 $?

# --- 3. 直前の行の断り
cat > "$WORK/src/ui/a.ts" <<'TS'
// 検査除外: 表示する時計に使うだけである
const now = new Date()
TS
( cd "$WORK" && node "$CLI" >/dev/null 2>&1 ); check "直前の行の断りで見逃す" 0 $?

# --- 4. 理由の無い断りは通さない
cat > "$WORK/src/ui/a.ts" <<'TS'
// 検査除外:
const now = new Date()
TS
( cd "$WORK" && node "$CLI" >/dev/null 2>&1 ); check "理由の無い断りは通さない" 1 $?

# --- 5. 全角コロンの断り
cat > "$WORK/src/ui/a.ts" <<'TS'
# 検査除外：表示する時計に使うだけである
const now = new Date()
TS
( cd "$WORK" && node "$CLI" >/dev/null 2>&1 ); check "全角コロンとハッシュ記号でも通る" 0 $?

# --- 6. パスにコロンを含むファイル（元の実装が壊れる）
rm -f "$WORK/src/ui/a.ts"
cat > "$WORK/src/ui/a:b.ts" <<'TS'
const total = xs.reduce((a, b) => a + b, 0)
TS
out=$( cd "$WORK" && node "$CLI" 2>&1 ); code=$?
check "パスにコロンがあっても落とせる" 1 $code
if printf '%s' "$out" | grep -q 'src/ui/a:b.ts:1'; then
  printf 'OK   %-46s\n' "パスにコロンがあっても出力が崩れない"; pass=$((pass + 1))
else
  printf 'NG   %-46s\n' "パスにコロンがあっても出力が崩れない"; printf '%s\n' "$out"; fail=$((fail + 1))
fi
rm -f "$WORK/src/ui/a:b.ts"

# --- 7. 拡張子で絞る
cat > "$WORK/src/ui/a.js" <<'JS'
const now = new Date()
JS
( cd "$WORK" && node "$CLI" >/dev/null 2>&1 ); check "対象外の拡張子は見ない" 0 $?
rm -f "$WORK/src/ui/a.js"

# --- 8. exclude
cat > "$WORK/src/ui/a.test.ts" <<'TS'
const now = new Date()
TS
( cd "$WORK" && node "$CLI" >/dev/null 2>&1 ); check "exclude の指定を除く" 0 $?
rm -f "$WORK/src/ui/a.test.ts"

# --- 9. 対象が無ければ 2
cat > "$WORK/missing.config.json" <<'JSON'
{ "targets": [ { "path": "src/nowhere", "rules": [ { "code": "X", "pattern": "a", "message": "m" } ] } ] }
JSON
( cd "$WORK" && node "$CLI" -c missing.config.json >/dev/null 2>&1 ); check "対象が無ければ 2 で止まる" 2 $?

# --- 10. optional なら飛ばす
cat > "$WORK/optional.config.json" <<'JSON'
{ "targets": [ { "path": "src/nowhere", "optional": true, "rules": [ { "code": "X", "pattern": "a", "message": "m" } ] } ] }
JSON
( cd "$WORK" && node "$CLI" -c optional.config.json >/dev/null 2>&1 ); check "optional なら対象が無くても通る" 0 $?

# --- 11. バイナリは飛ばす
printf 'new Date(\x00\x01\x02' > "$WORK/src/ui/blob.ts"
( cd "$WORK" && node "$CLI" >/dev/null 2>&1 ); check "バイナリは飛ばす" 0 $?
rm -f "$WORK/src/ui/blob.ts"

# --- 12. シンボリックリンクは辿らない
cat > "$WORK/src/core/bad.ts" <<'TS'
const now = new Date()
TS
ln -s "$WORK/src/core" "$WORK/src/ui/linked"
( cd "$WORK" && node "$CLI" >/dev/null 2>&1 ); check "シンボリックリンクを辿らない" 0 $?
rm -f "$WORK/src/ui/linked"

# --- 13. POSIX 文字クラスは設定の誤りとして止める
cat > "$WORK/posix.config.json" <<'JSON'
{ "targets": [ { "path": "src/ui", "rules": [ { "code": "X", "pattern": "foo[[:space:]]bar", "message": "m" } ] } ] }
JSON
out=$( cd "$WORK" && node "$CLI" -c posix.config.json 2>&1 ); code=$?
check "POSIX 文字クラスは 2 で止める" 2 $code
if printf '%s' "$out" | grep -q 'POSIX'; then
  printf 'OK   %-46s\n' "POSIX 文字クラスの理由を示す"; pass=$((pass + 1))
else
  printf 'NG   %-46s\n' "POSIX 文字クラスの理由を示す"; fail=$((fail + 1))
fi

# --- 14. 不正な正規表現
cat > "$WORK/badre.config.json" <<'JSON'
{ "targets": [ { "path": "src/ui", "rules": [ { "code": "X", "pattern": "foo(", "message": "m" } ] } ] }
JSON
( cd "$WORK" && node "$CLI" -c badre.config.json >/dev/null 2>&1 ); check "読めない正規表現は 2 で止める" 2 $?

# --- 15. JSON 形式の出力
cat > "$WORK/src/ui/a.ts" <<'TS'
const now = new Date()
TS
out=$( cd "$WORK" && node "$CLI" -f json 2>/dev/null )
if printf '%s' "$out" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);process.exit(j.violationCount===1&&j.violations[0].code==='LINT001'?0:1)})"; then
  printf 'OK   %-46s\n' "JSON 形式で出せる"; pass=$((pass + 1))
else
  printf 'NG   %-46s\n' "JSON 形式で出せる"; printf '%s\n' "$out"; fail=$((fail + 1))
fi

# --- 16. 文字列リテラル内の断りも効いてしまう（既知の限界）
cat > "$WORK/src/ui/a.ts" <<'TS'
const s = "検査除外: これは文字列である"
const now = new Date()
TS
( cd "$WORK" && node "$CLI" >/dev/null 2>&1 )
printf 'INFO 文字列内の断りも効く（既知の限界。exit %s）\n' $?

printf '\n通過 %s / 失敗 %s\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
