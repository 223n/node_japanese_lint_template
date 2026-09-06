#!/bin/bash
# 語彙検査 CLI の検証。
#
# 素朴なシェル実装が取りこぼす場面（パスにコロンが含まれる、パイプに出す、
# 対象が空になる）も含めて見る。
set -u
CLI="$(cd "$(dirname "$0")/.." && pwd)/bin/lint-vocabulary.mjs"
# 作業場はリポジトリの外に作る。
# 中に作ると、生成物（大きな .txt など）を textlint が検査対象に拾って止まる
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
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
printf 'export const ok = 1\n' > "$WORK/src/ui/keep.ts"
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

# --- 11. バイナリは飛ばす（飛ばしたことは黙らない）
printf 'new Date(\x00\x01\x02' > "$WORK/src/ui/blob.ts"
( cd "$WORK" && node "$CLI" >/dev/null 2>&1 ); check "バイナリは飛ばす" 0 $?
msg=$( cd "$WORK" && node "$CLI" 2>&1 >/dev/null )
if printf '%s' "$msg" | grep -q '飛ばした'; then
  printf 'OK   %-46s\n' "飛ばしたことを黙らずに報告する"; pass=$((pass + 1))
else
  printf 'NG   %-46s\n' "飛ばしたことを黙らずに報告する"; fail=$((fail + 1))
fi
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


# --- 17. 1件も見ていないのに成功と言わない
mkdir -p "$WORK/empty/src/ui"
cat > "$WORK/empty/lint-vocabulary.config.json" <<'JSON'
{ "targets": [ { "path": "src/ui", "extensions": [".ts"], "rules": [ { "code": "X", "pattern": "a", "message": "m" } ] } ] }
JSON
( cd "$WORK/empty" && node "$CLI" >/dev/null 2>&1 ); check "1件も見ていなければ 2 で止める" 2 $?

cat > "$WORK/empty/optional.config.json" <<'JSON'
{ "targets": [ { "path": "src/ui", "optional": true, "extensions": [".ts"], "rules": [ { "code": "X", "pattern": "a", "message": "m" } ] } ] }
JSON
( cd "$WORK/empty" && node "$CLI" -c optional.config.json >/dev/null 2>&1 ); check "optional なら空でも通る" 0 $?

# --- 18. 検査した件数を必ず言う
out=$( cd "$WORK" && node "$CLI" 2>/dev/null )
if printf '%s' "$out" | grep -qE '件を検査'; then
  printf 'OK   %-46s\n' "検査した件数を出す"; pass=$((pass + 1))
else
  printf 'NG   %-46s\n' "検査した件数を出す"; printf '%s\n' "$out"; fail=$((fail + 1))
fi

# --- 19. 読めないディレクトリを黙って飛ばさない
if [ "$(id -u)" -eq 0 ]; then
  printf 'SKIP %-46s（rootでは権限が効かない）\n' "読めないディレクトリで止まる"
else
  mkdir -p "$WORK/src/ui/locked"
  printf 'export const ok = 1\n' > "$WORK/src/ui/locked/x.ts"
  chmod 000 "$WORK/src/ui/locked"
  ( cd "$WORK" && node "$CLI" >/dev/null 2>&1 ); check "読めないディレクトリで止まる" 2 $?
  chmod 755 "$WORK/src/ui/locked"
  rm -rf "$WORK/src/ui/locked"
fi

# --- 20. パイプに出しても切り捨てない
mkdir -p "$WORK/many/src/ui"
cp "$WORK/lint-vocabulary.config.json" "$WORK/many/"
awk 'BEGIN { for (i = 0; i < 20000; i++) print "const x = new Date()" }' > "$WORK/many/src/ui/big.ts"
piped=$( cd "$WORK/many" && node "$CLI" 2>/dev/null | wc -l )
( cd "$WORK/many" && node "$CLI" > "$WORK/many/out.txt" 2>/dev/null )
direct=$( wc -l < "$WORK/many/out.txt" )
if [ "$piped" = "$direct" ] && [ "$piped" -gt 40000 ]; then
  printf 'OK   %-46s（%s 行）\n' "パイプに出しても切り捨てない" "$piped"; pass=$((pass + 1))
else
  printf 'NG   %-46s（パイプ %s / ファイル %s）\n' "パイプに出しても切り捨てない" "$piped" "$direct"; fail=$((fail + 1))
fi

# --- 21. パイプに出した JSON が壊れない
if ( cd "$WORK/many" && node "$CLI" -f json 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{JSON.parse(s)})" ); then
  printf 'OK   %-46s\n' "パイプに出した JSON が壊れない"; pass=$((pass + 1))
else
  printf 'NG   %-46s\n' "パイプに出した JSON が壊れない"; fail=$((fail + 1))
fi

# --- 22. UTF-8 でないファイルは飛ばし、そのことを言う
printf 'export const ok = 1\n' > "$WORK/src/ui/keep2.ts"
printf '// \x93\xfa\x96{\x8c\xea\nconst now = new Date()\n' > "$WORK/src/ui/sjis.ts"
msg=$( cd "$WORK" && node "$CLI" 2>&1 >/dev/null )
if printf '%s' "$msg" | grep -q 'UTF-8'; then
  printf 'OK   %-46s\n' "UTF-8 でないファイルを報告する"; pass=$((pass + 1))
else
  printf 'NG   %-46s\n' "UTF-8 でないファイルを報告する"; printf '%s\n' "$msg"; fail=$((fail + 1))
fi
rm -f "$WORK/src/ui/sjis.ts"


# --- 23. 設定の型が違ってもスタックトレースを出さない
for bad in \
  '{"targets":[{"path":"src/ui","exclude":"配列でない","rules":[{"code":"X","pattern":"a","message":"m"}]}]}' \
  '{"targets":[{"path":"src/ui","optional":"yes","rules":[{"code":"X","pattern":"a","message":"m"}]}]}'
do
  printf '%s' "$bad" > "$WORK/bad.config.json"
  out=$( cd "$WORK" && node "$CLI" -c bad.config.json 2>&1 ); code=$?
  traces=$( printf '%s' "$out" | grep -c '    at ' || true )
  if [ "$code" = "2" ] && [ "$traces" = "0" ]; then
    printf 'OK   %-46s\n' "型の誤りを 2 で伝える（trace なし）"; pass=$((pass + 1))
  else
    printf 'NG   %-46s（exit %s / trace %s 行）\n' "型の誤りを 2 で伝える" "$code" "$traces"; fail=$((fail + 1))
  fi
done

# --- 24. 拡張子の大小を区別しない
mkdir -p "$WORK/case/src/ui"
printf '{"targets":[{"path":"src/ui","extensions":[".ts"],"rules":[{"code":"X","pattern":"new Date","message":"m"}]}]}' > "$WORK/case/lint-vocabulary.config.json"
printf 'const x = new Date()\n' > "$WORK/case/src/ui/A.TS"
( cd "$WORK/case" && node "$CLI" >/dev/null 2>&1 ); check "拡張子の大小を区別しない" 1 $?

# --- 25. exclude の ? が1文字に当たる
mkdir -p "$WORK/glob/src/ui"
printf 'export const ok = 1\n' > "$WORK/glob/src/ui/keep.ts"
printf 'const x = new Date()\n' > "$WORK/glob/src/ui/a1.ts"
printf '{"targets":[{"path":"src/ui","extensions":[".ts"],"exclude":["a?.ts"],"rules":[{"code":"X","pattern":"new Date","message":"m"}]}]}' > "$WORK/glob/lint-vocabulary.config.json"
( cd "$WORK/glob" && node "$CLI" >/dev/null 2>&1 ); check "exclude の ? が1文字に当たる" 0 $?

# --- 26. exclude の ** が区切りを越える
mkdir -p "$WORK/glob/src/ui/deep/deeper"
printf 'const x = new Date()\n' > "$WORK/glob/src/ui/deep/deeper/b.ts"
printf '{"targets":[{"path":"src/ui","extensions":[".ts"],"exclude":["a?.ts","deep/**"],"rules":[{"code":"X","pattern":"new Date","message":"m"}]}]}' > "$WORK/glob/lint-vocabulary.config.json"
( cd "$WORK/glob" && node "$CLI" >/dev/null 2>&1 ); check "exclude の ** が区切りを越える" 0 $?

printf '\n通過 %s / 失敗 %s\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
