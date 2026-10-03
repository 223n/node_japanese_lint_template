// 普通体の文末を拾う規則（rules/desumasu-ending.js）と、それを組み込む設定の検証。
//
// test/run.sh と同じく、1件ごとに OK か NG を出し、失敗があれば 1 で終える。
// 規則は textlint の API で動かす。
// 配る設定と同じく、文中の textlint-disable が効く状態（comments のフィルター）で試す。

import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { createLinter, loadTextlintrc } from 'textlint'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const rule = require(path.join(ROOT, 'rules', 'desumasu-ending.js'))
const { createTextlintConfig } = require(
  path.join(ROOT, 'config', 'textlint-base.js'),
)
const pkg = require(path.join(ROOT, 'package.json'))

// 利用側で使う名前と同じものを、規則の名前にする
const RULE_ID = `${pkg.name}/rules/desumasu-ending`

// フィルターだけを持つ設定を、リポジトリの外に置いて読む。
// .js の設定を configFilePath で渡すと、textlint（rc-config-loader）が
// YAML の文字列として読んでしまい、規則もフィルターも空になるため、JSON で書く
const work = mkdtempSync(path.join(os.tmpdir(), 'desumasu-ending-'))
let base
try {
  const configFilePath = path.join(work, '.textlintrc.json')
  writeFileSync(configFilePath, JSON.stringify({ filters: { comments: true } }))
  base = await loadTextlintrc({ configFilePath })
} finally {
  rmSync(work, { recursive: true, force: true })
}
if (base.filterRule.descriptors.length === 0) {
  console.log('NG   comments のフィルターを読めない')
  process.exit(1)
}

let pass = 0
let fail = 0

function check(name, ok, detail = '') {
  if (ok) {
    console.log(`OK   ${name}`)
    pass++
  } else {
    console.log(`NG   ${name}${detail ? `（${detail}）` : ''}`)
    fail++
  }
}

/** 規則だけを当てて、指摘を返す */
async function lint(text, options = {}) {
  const descriptor = base.shallowMerge({
    rules: [{ ruleId: RULE_ID, rule, options }],
  })
  const result = await createLinter({ descriptor }).lintText(text, 'test.md')
  return result.messages.filter((m) => m.ruleId === RULE_ID)
}

/** 指摘の数を見る */
async function expectCount(name, text, expected, options) {
  const messages = await lint(text, options)
  check(
    name,
    messages.length === expected,
    `期待 ${expected} / 実際 ${messages.length}${messages.length ? `: ${messages.map((m) => m.message).join(' / ')}` : ''}`,
  )
  return messages
}

/**
 * 指摘の位置と文言を見る。
 * expected は [行, 桁, 文言に含まれる文字列] の配列で、指摘の順に並べる
 */
async function expectAt(name, text, expected, options) {
  const messages = await lint(text, options)
  const actual = messages.map((m) => `${m.line}:${m.column} ${m.message}`)
  const ok =
    messages.length === expected.length &&
    expected.every(
      ([line, column, excerpt], i) =>
        messages[i].line === line &&
        messages[i].column === column &&
        messages[i].message.includes(excerpt),
    )
  check(name, ok, `期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`)
}

/** 例外を投げることを見る */
function expectThrow(name, fn, pattern) {
  try {
    fn()
    check(name, false, '例外が出なかった')
  } catch (error) {
    check(name, pattern.test(error.message), error.message)
  }
}

/** 規則のオプションが不正なら、検査が止まることを見る */
async function expectRuleError(name, options, pattern) {
  let message = ''
  try {
    await lint('動作を確かめます。\n', options)
  } catch (error) {
    message = error.message
  }
  check(name, pattern.test(message), message || '止まらなかった')
}

const table = (cell) => `| 項目 | 説明 |\n| ---- | ---- |\n| 圧縮 | ${cell} |\n`

// ---- 1. 普通体の文末を拾う

await expectCount('本文: 動詞の終止形を拾う', '動作を確かめる。\n', 1)
await expectCount('本文: 「〜はない」を拾う', '問題はない。\n', 1)
await expectCount('本文: 過去形を拾う', '設定を変えた。\n', 1)
await expectCount('本文: 「だ」を拾う', '設定は必須だ。\n', 1)
await expectCount('本文: 1行の2文を別々に拾う', '設定を変えた。動作を確かめる。\n', 2)
await expectCount('本文: 「〜による」を拾う', '値は環境による。\n', 1)
await expectCount('箇条書き: 句点のある文を拾う', '- 動作を確かめる。\n', 1)
await expectCount('箇条書き: 句点の無い断片を拾う', '- 派生画像はブラウザで作る\n', 1)
await expectCount('表: 句点の無い断片を拾う', table('使わない'), 1)
await expectCount('表: 句点のある文を拾う', table('サーバーでは作らない。'), 1)
await expectCount('「べき」を拾う', '設定を当てるべき。\n', 1)
await expectCount('「〜のか。」を拾う', '設定を変えるのか。\n', 1)
await expectCount('「〜なのか。」を拾う', '要求全体なのか。\n', 1)
await expectCount('「〜のか？」を拾う', '設定を変えるのか？\n', 1)
await expectCount('句点で終わる「〜か。」を拾う', 'これは使えるか。\n', 1)
await expectCount('「〜てくださる。」を拾う', '管理者が承認してくださる。\n', 1)
await expectCount('「〜てくださった。」を拾う', '前の担当者が直してくださった。\n', 1)
await expectCount('句点で終わる「〜ず。」を拾う', 'これを使わず。\n', 1)
await expectCount('「〜するので。」を拾う', '時間がかかるので。\n', 1)
await expectCount('「〜したけど。」を拾う', '一度試したけど。\n', 1)

// 文を区切る記号
await expectCount('「!」で終わる文を拾う', 'これは使う!\n', 1)
await expectCount('「?」で終わる文を拾う', 'これは使う?\n', 1)
await expectCount('「．」で終わる文を拾う', 'これは使う．\n', 1)
await expectCount('箇条書きの「?」で区切る', '- 使う? 使わない\n', 2)
await expectCount('数の中の「．」では区切らない', '１．５倍にする。\n', 1)
await expectCount('URL の中の「?」では区切らない', '詳しくは https://example.com/?q=設定を変える を見てください。\n', 0)

// 改行して見せる記号（<br> と強い改行）で、断片を区切る
await expectCount('表: <br> の前の断片を拾う', table('使わない<br>推奨'), 1)
await expectCount('表: <br> の前後を別々に拾う', table('使う<br>確かめる'), 2)
await expectCount('箇条書き: 行末の「\\」の前の断片を拾う', '- 項目を使わない\\\n  推奨\n', 1)
await expectCount('箇条書き: 行末の空白2つの前の断片を拾う', '- 項目を使わない  \n  推奨\n', 1)
// 段落の中のただの改行は、表示では1行につながる。1つの断片として末尾だけを見る
await expectCount('箇条書き: ただの改行では区切らない', '- 項目を使わない\n  推奨\n', 0)

// 文末に付いた参照の印、注の番号、コロン、絵文字は外して見る
await expectCount('「［1］」を外す', 'そこは調べておく必要がある［1］。\n', 1)
await expectCount('「〔注〕」を外す', 'そこは調べておく必要がある〔注〕。\n', 1)
await expectCount('「[1]」を外す', 'そこは調べておく必要がある[1]。\n', 1)
await expectCount('「※1」を外す', 'そこは調べておく必要がある※1。\n', 1)
await expectCount('<sup> の注の番号を外す', '設定を変える<sup>1</sup>。\n', 1)
await expectCount('文末のコロンを外す', '- 次のように書く:\n', 1)
await expectCount('表: 文末の全角のコロンを外す', table('確かめる：'), 1)
await expectCount('表: 文末の絵文字を外す', table('使える ✅'), 1)

// 全体がかっこの中にあるものは、内側を見る
await expectCount('表: 全体がかっこの中の断片を拾う', table('（後で決める）'), 1)
await expectCount('箇条書き: 全体がかっこの中の断片を拾う', '- （後で決める）\n', 1)
await expectCount('全体がかっこの中でも名詞なら拾わない', table('（なし）'), 0)

// 指摘の文言と位置。述語の始まりを指し、どの文末かが文言で分かる
{
  const [message] = await lint('動作を確かめる。\n')
  check(
    '文言に文末の語が入る',
    message && message.message.includes('〜を確かめる'),
    message && message.message,
  )
  check(
    '位置は述語の始まりを指す',
    message && message.line === 1 && message.column === 4,
    message && `${message.line}:${message.column}`,
  )
}
// 絵文字や「𠮷」のようなサロゲートペアの後ろでも、位置と文言がずれない
await expectAt('サロゲートペアの後ろ: 箇条書き', '- 🚀 動作を確かめる\n', [[1, 9, '（〜を確かめる）']])
await expectAt('サロゲートペアの後ろ: 本文', '設定は 𠮷野家 で変える。\n', [[1, 11, '（〜で変える）']])
await expectAt('サロゲートペアの後ろ: 表', table('😀設定を変える'), [[3, 13, '（〜を変える）']])
// 箇条書きの続きの行でも、字下げの分だけ位置がずれない
await expectAt('続きの行: 箇条書き', '- 項目\n  動作を確かめる。\n', [[2, 6, '（〜を確かめる）']])
await expectAt('続きの行: 番号付きの箇条書き', '1. 項目\n   動作を確かめる。\n', [[2, 7, '（〜を確かめる）']])
await expectAt(
  '続きの行: 入れ子の箇条書き',
  '- 親\n  - 子の項目\n    動作を確かめる。\n',
  [[3, 8, '（〜を確かめる）']],
)
await expectAt('<br> の後ろの位置', table('使う<br>確かめる'), [
  [3, 8, '（使う）'],
  [3, 14, '（確かめる）'],
])

// ---- 2. 丁寧な文末は拾わない

for (const [label, sentence] of [
  ['です', '設定は必須です。'],
  ['ます', '動作を確かめます。'],
  ['ました', '設定を変えました。'],
  ['ません', '問題はありません。'],
  ['でした', '原因は設定でした。'],
  ['でしょう', '問題は無いでしょう。'],
  ['ください', '動作を確かめてください。'],
  ['ませんでした', '原因は分かりませんでした。'],
  ['ですか', 'これで足りますか？'],
  ['ましょう', '動作を確かめましょう。'],
  ['しないでください', '設定を変えないでください。'],
  ['くださいます', '担当者が直してくださいます。'],
  ['のですか', '設定を変えるのですか。'],
  ['ますので', '設定を保存しますので。'],
]) {
  await expectCount(`丁寧な文末は拾わない（${label}）`, `${sentence}\n`, 0)
}
await expectCount(
  '丁寧な文末は箇条書きと表でも拾わない',
  `- 動作を確かめます\n\n${table('使いません')}`,
  0,
)

// ---- 3. 体言止め、記号、名詞のように置いた語は拾わない

await expectCount('体言止めは拾わない（本文）', '既定値は推奨。\n', 0)
await expectCount('体言止めは拾わない（箇条書き）', '- P0\n- 約70GB\n- 推奨\n', 0)
await expectCount('体言止めは拾わない（表）', table('約70GB'), 0)
await expectCount('「あり」「なし」は拾わない', `${table('あり')}| 暗号化 | なし |\n`, 0)
await expectCount('記号で終わるものは拾わない', '- 優先度: ★★★\n', 0)
await expectCount('「〜のような」「〜な」は拾わない', '- 次のような\n- 簡単な\n', 0)
await expectCount('断片の「〜せず」は拾わない', '- 変換せず\n', 0)
await expectCount('「次の3つ」は拾わない', '違う点は次の3つ。\n', 0)
await expectCount('「（〜）だけ」は拾わない', '対応はSafari（17以降）だけ。\n', 0)

// ---- 4. 文末ではない形

// 断片の末尾の「〜か」は、名詞のように置いた間接疑問である（「書き出せますか」に直すと意味が変わる）
await expectCount('箇条書き: 断片の「〜か」は拾わない', '- WebPを書き出せるか\n- 設定を変えるのか\n', 0)
await expectCount('表: 断片の「〜か」は拾わない', table('撮影日時を入れるか'), 0)
// 断片の末尾の接続助詞は、表の左の列に置いた条件のような、言い切っていない形である
for (const cell of ['保存すると', '保存するので', '保存するのに', '保存するから', '保存するが']) {
  await expectCount(`表: 接続助詞で終わる断片は拾わない（${cell}）`, table(cell), 0)
}
await expectCount('「〜と。」は拾わない', 'ボタンを押すと。\n', 0)

// ---- 5. 引用の可能性があるもの

await expectCount('閉じかぎで終わる文は拾わない', '次のように書く「例」。\n', 0)
await expectCount(
  'かぎかっこの中の句点では文を割らない',
  '「これは例である。」と書きます。\n',
  0,
)
await expectCount('二重かぎで終わる断片は拾わない', '- 『これは例である』\n', 0)
for (const [label, quoted] of [
  ['“”', '“ファイルが見つからない。”'],
  ['半角の"', '"ファイルが見つからない。"'],
  ['〝〟', '〝ファイルが見つからない。〟'],
  ['《》', '《ファイルが見つからない。》'],
]) {
  await expectCount(
    `引用の中の句点では文を割らない（${label}）`,
    `エラーは ${quoted} と表示されます。\n`,
    0,
  )
}
await expectCount('閉じの“”で終わる文は拾わない', '次のように書く“例”。\n', 0)
await expectCount(
  'かぎかっこが段落の中の改行をまたいでも文を割らない',
  'エラーの文言は「ファイルが見つからない。\nパスを確かめる。」のように出ます。\n',
  0,
)
await expectCount('閉じ忘れたかぎかっこは後ろの文を巻き込まない', '「これは閉じ忘れ。\n設定を変える。\n', 1)
await expectCount('対にならない半角の"は引用とみなさない', 'サイズは 5" です。設定を変える。\n', 1)

// ---- 6. 文末の丸かっこの注記は外してから見る

await expectCount('注記を外すと丁寧なら拾わない', '注記を付けます（4.10）。\n', 0)
await expectCount('注記を外すと普通体なら拾う', '注記を付ける（4.10）。\n', 1)
await expectCount('隅付きかっこの注記も外す', '設定を変える【未確認】。\n', 1)
await expectCount(
  '丸かっこの中の句点で終わる文は見る',
  '動作を確かめます。（影響: 古い端末では表示できない。）\n',
  1,
)

// ---- 7. 見ないところ

await expectCount('見出しは見ない', '# 動作を確かめる\n', 0)
await expectCount('引用は見ない', '> 動作を確かめる。\n', 0)
await expectCount('コードブロックは見ない', '```text\n動作を確かめる。\n```\n', 0)
await expectCount('文末のコードスパンは見ない', '値は`する`。\n', 0)
await expectCount('コードスパンの中の句点では文を割らない', '値は`a。b`です。\n', 0)
await expectCount('HTMLは見ない', '<div>動作を確かめる。</div>\n', 0)
await expectCount(
  'リンクのURLは見ない',
  '詳しくは[説明](https://example.com/確かめる)を見てください。\n',
  0,
)
await expectCount('URL を書いた文字列は見ない（裸の URL）', '- 詳細: https://github.com/223n/x#文体をですます調にする\n', 0)
await expectCount('URL を書いた文字列は見ない（<〜>）', '- 参考: <https://example.jp/docs/設定を変える>\n', 0)
await expectCount(
  '裸の URL の後ろに続けた文は見る',
  '参照（https://example.com/a）。設定を変える。\n',
  1,
)
await expectCount(
  '裸の URL に取り込まれた全角のかっこと句点は、文の区切りとして見る',
  '- 設計の前提に入れる必要がある（https://help.sakura.ad.jp/n-2692）。\n',
  1,
)
await expectCount(
  'ページ内リンクの文字列は見ない（目次）',
  `- [パッケージを入れる](#パッケージを入れる)\n- [文体をですます調にする](#文体をですます調にする)\n\n${table('[パッケージを入れる](#パッケージを入れる)')}`,
  0,
)
await expectCount(
  'ページ内リンクの後ろに続けた文は見る',
  '詳しくは[設定を変える](#設定を変える)を読む。\n',
  1,
)
await expectCount('リンクだけを並べた箇条書きは見ない', '- [設定を変える](https://example.com/config)\n', 0)
await expectCount(
  'リンクの後ろに続けた文は見る',
  '- [設定を変える](https://example.com/config) を見る\n',
  1,
)
await expectCount('画像の代替テキストは見ない', `![設定画面を開く。](a.png)\n\n${table('![ボタンを押す](b.png)')}`, 0)
await expectCount(
  '表の見出しの行は見ない',
  '| 何に使うか | どうする |\n| ---- | ---- |\n| 圧縮 | 使います |\n',
  0,
)
await expectCount('引用の中の表は見ない', '> | a | b |\n> | - | - |\n> | x | 使わない |\n', 0)
await expectCount(
  '本文の段落では句点の無い断片を見ない',
  '最終更新: 2026-09-04に確かめる\n',
  0,
)

// ---- 8. オプション

await expectCount(
  'checkFragments: false で箇条書きの断片を見ない',
  '- 派生画像はブラウザで作る\n',
  0,
  { checkFragments: false },
)
await expectCount(
  'checkFragments: false で表の断片を見ない',
  table('使わない'),
  0,
  { checkFragments: false },
)
await expectCount(
  'checkFragments: false でも句点のある文は見る',
  '- 動作を確かめる。\n',
  1,
  { checkFragments: false },
)
await expectCount('checkTable: false で表を見ない', table('使わない'), 0, {
  checkTable: false,
})
await expectCount('checkList: false で箇条書きを見ない', '- 動作を確かめる。\n', 0, {
  checkList: false,
})
await expectCount('allow に正規表現の本体を書ける', '動作を確かめる。\n', 0, {
  allow: ['確かめる$'],
})
await expectCount('allow に「/〜/」の形で書ける', '動作を確かめる。\n', 0, {
  allow: ['/^動作/'],
})
await expectCount('allow に RegExp を渡せる', '動作を確かめる。\n', 0, {
  allow: [/確かめる/],
})
await expectCount(
  'allow の g フラグで結果が揺れない',
  '動作を確かめる。設定を確かめる。\n',
  0,
  { allow: ['/確かめる$/g'] },
)
await expectCount('allow に当たらない文は拾う', '動作を確かめる。設定を変える。\n', 1, {
  allow: ['確かめる$'],
})
await expectRuleError('allow の読めない正規表現で止まる', { allow: ['('] }, /allow/)
await expectRuleError('allow が配列でなければ止まる', { allow: null }, /allow/)
// 引用符付きの "false" は真とみなされ、意図と逆に動く。黙って続けずに止める
await expectRuleError('checkTable が真偽値でなければ止まる', { checkTable: 'false' }, /checkTable/)
await expectRuleError('checkList が真偽値でなければ止まる', { checkList: 0 }, /checkList/)
await expectRuleError(
  'checkFragments が真偽値でなければ止まる',
  { checkFragments: 'false' },
  /checkFragments/,
)
await expectRuleError('知らない名前のオプションで止まる', { checkFragment: false }, /checkFragment/)
// textlint が規則のオプションに混ぜて渡す severity は通す
await expectCount('severity を書いても止まらない', '動作を確かめる。\n', 1, { severity: 'warning' })

// ---- 9. 文中のコメントで止められる

await expectCount(
  'textlint-disable で止められる',
  `<!-- textlint-disable ${RULE_ID} -->\n\n動作を確かめる。\n\n<!-- textlint-enable ${RULE_ID} -->\n`,
  0,
)

// ---- 10. 設定への組み込み

{
  const desumasu = createTextlintConfig({ style: 'ですます', desumasuEnding: false })
  check('desumasuEnding: false なら規則を入れない', !Object.hasOwn(desumasu.rules, RULE_ID))
  check(
    'ですます調の既定では規則を入れる',
    createTextlintConfig({ style: 'ですます' }).rules[RULE_ID] === true,
  )
  check(
    'ですます調の既定は desumasuEnding: true と同じ設定を返す',
    isDeepStrictEqual(
      createTextlintConfig({ style: 'ですます' }),
      createTextlintConfig({ style: 'ですます', desumasuEnding: true }),
    ),
  )
  check(
    'である調の既定では規則を入れない',
    !Object.hasOwn(createTextlintConfig().rules, RULE_ID),
  )
  check(
    'である調で desumasuEnding: false は既定と同じ設定を返す',
    isDeepStrictEqual(
      createTextlintConfig(),
      createTextlintConfig({ desumasuEnding: false }),
    ),
  )

  const enabled = createTextlintConfig({ style: 'ですます', desumasuEnding: true })
  check('desumasuEnding: true で規則が入る', enabled.rules[RULE_ID] === true)
  // 規則の名前はパッケージの中のファイルを指す。名前を書き損じると利用側で読めなくなる
  const file = path.join(ROOT, `${RULE_ID.slice(pkg.name.length + 1)}.js`)
  check('規則の名前が実在するファイルを指す', existsSync(file), file)
  check(
    'desumasuEnding: true でもほかの規則は変わらない',
    isDeepStrictEqual(
      Object.fromEntries(Object.entries(enabled.rules).filter(([k]) => k !== RULE_ID)),
      desumasu.rules,
    ),
  )
}

expectThrow(
  'である調で desumasuEnding: true なら止まる',
  () => createTextlintConfig({ desumasuEnding: true }),
  /desumasuEnding.*ですます/,
)
expectThrow(
  'desumasuEnding が真偽値でなければ止まる',
  () => createTextlintConfig({ style: 'ですます', desumasuEnding: 'true' }),
  /desumasuEnding/,
)

console.log(`\n通過 ${pass} / 失敗 ${fail}`)
process.exitCode = fail === 0 ? 0 : 1
