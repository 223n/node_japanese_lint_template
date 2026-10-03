'use strict'

// ですます調の文書に混ざった、普通体の文末を拾う規則。
//
// preset-ja-technical-writing の no-mix-dearu-desumasu が拾うのは、「である」「だ」のような
// 明示的な常体だけである。「〜を確かめる。」「〜はない。」「〜した。」のような普通体の文末は
// 素通りし、表のセルはそもそも見ない。ですます調の文書にそうした文末が混ざっても検査を通る。
// この規則は、文末の述語に「です」「ます」が含まれるかを形態素解析で見て、その穴を埋める。
//
// 自動の修正（fixer）は付けない。活用の変換は語によって形が変わり、誤りやすいためである。
//
// 利用側では、規則の名前 '@223n/lint-config-ja/rules/desumasu-ending' で読み込む。
// textlint はこの名前を require.resolve で解決する。

const { StringSource } = require('textlint-util-to-string')
const { tokenize } = require('kuromojin')

const DEFAULT_OPTIONS = {
  // 表のセルを見るか
  checkTable: true,
  // 箇条書きの項目を見るか
  checkList: true,
  // 表のセルと箇条書きの項目で、「。」の無い断片の末尾も見るか。
  // 本文の段落では、「。」などで終わる文だけを見る。
  // 「最終更新: 2026-09-04」のような、文ではない行を拾わないためである
  checkFragments: true,
  // 報告しない文の正規表現。文の全体（Markdown の記号を除き、句点は含まない）に当てる
  allow: [],
}
const BOOLEAN_OPTIONS = ['checkTable', 'checkList', 'checkFragments']
// textlint が規則のオプションに混ぜて渡す名前。.textlintrc の { "severity": "warning" } である
const TEXTLINT_OPTION_NAMES = new Set(['severity'])

// 文を区切る記号。後ろに何が来ても区切る
const TERMINATORS = new Set(['。', '？', '！', '．'])
// 半角の「?」「!」。後ろが空白、行末、閉じかっこのときだけ区切る。
// URL の「?q=」や、英語の中の記号で文を割らないためである
const HALF_TERMINATORS = new Set(['?', '!'])
const TERMINATOR_CHARS = new Set([...TERMINATORS, ...HALF_TERMINATORS])

// 引用の記号。対になる閉じがあるときだけ、内側を引用として扱う。
// 内側の句点では区切らず、文としても見ない。
// 「「〜である。」と書きます。」を2文に割らないためである
const QUOTE_PAIRS = [
  ['「', '」'],
  ['『', '』'],
  ['“', '”'],
  ['〝', '〟'],
  ['〝', '〞'],
  ['《', '》'],
  ['‘', '’'],
]
// 半角の「"」は、開きと閉じが同じ記号である。開いていなければ開き、開いていれば閉じとみなす
const SYMMETRIC_QUOTE = '"'
// かっこ。内側の句点で終わる文は、書き手の文として見る（「（影響: 〜できる。）」）。
// 句点の無い注記（「（4.10）」「【未確認】」「［1］」）は見ず、外側の文の一部として扱う
const PAREN_PAIRS = [
  ['（', '）'],
  ['(', ')'],
  ['【', '】'],
  ['［', '］'],
  ['〔', '〕'],
  ['[', ']'],
]
const QUOTE_OPENERS = new Set([...QUOTE_PAIRS.map(([open]) => open), SYMMETRIC_QUOTE])
const QUOTE_CLOSERS = new Set([...QUOTE_PAIRS.map(([, close]) => close), SYMMETRIC_QUOTE])
const PAREN_OPENERS = new Set(PAREN_PAIRS.map(([open]) => open))
const PAREN_CLOSERS = new Set(PAREN_PAIRS.map(([, close]) => close))
// 閉じの記号から、対になりうる開きの記号を引く
const OPENERS_OF = new Map()
for (const [open, close] of [...QUOTE_PAIRS, ...PAREN_PAIRS]) {
  OPENERS_OF.set(close, (OPENERS_OF.get(close) || new Set()).add(open))
}

// 文末に付いた参照の印（「※」「※1」）、導入のコロン、絵文字。
// 述語の後ろに付いても文末の形は変わらないので、外してから判定する
const TRAILING_MARK = /(?:※[0-9０-９]*|[:：]|[\p{Extended_Pictographic}\u{FE0F}\u{200D}]+)$/u

// 改行して見せる記号（強い改行、<br>）を、文字列の中で表す文字。
// ここで断片を区切る。表のセルの「使わない<br>推奨」を、2つの断片として見るためである
const LINE_BREAK = '\u2028'
// 名詞として扱わせる伏せ字
const MASK = 'X'

// 丁寧とみなす助動詞（基本形で見る）。
// 「ました」「ません」「でした」「でしょう」は、それぞれ「ます」「です」の活用である
const POLITE_AUXILIARIES = new Set(['です', 'ます'])
// 丁寧とみなす動詞。命令形の「ください」だけである。
// 「くださる」「くださった」は普通体なので、基本形では引かない
const POLITE_VERBS = new Set(['くださる', '下さる'])

// 文を言い切る活用形。最後の述語がこれ以外の形（連用形など）なら報告しない。
// 表の「あり」「なし」「済み」のように、名詞として置かれたものを拾わないためである
const TERMINAL_FORMS = new Set([
  '基本形',
  '音便基本形',
  '命令ｅ',
  '命令ｒｏ',
  '命令ｙｏ',
  '命令ｉ',
])

// 「。」で終わる文の末尾で、外してから述語を見る接続助詞。
// 「〜するので。」「〜したけど。」は、丁寧にすると「〜しますので。」「〜しましたけど。」になる。
// これ以外（「と」「ば」「て」「ても」など）で終わるものは、言い切っていない形として報告しない。
// 「ボタンを押すと。」を丁寧にした「押しますと。」は不自然である
const TRAILING_CONJUNCTIVES = new Set(['が', 'けど', 'けれど', 'けれども', 'から', 'ので', 'のに', 'し'])

// 置き換えた節に付ける印
const BREAK_NODE = Symbol('desumasu-ending.break')
const NOUN_NODE = Symbol('desumasu-ending.noun')

const LINK_TYPES = new Set(['Link', 'LinkReference'])
const IMAGE_TYPES = new Set(['Image', 'ImageReference'])

// 判定に使う文字列。
// コードスパン、ページ内リンクと自動リンクの文字列、画像の代替テキストは、同じ長さの英字に伏せ、名詞として扱わせる。
// コードスパンは句点を含むことがあり、文の区切りを狂わせる。
// 強い改行と <br> は、断片の区切りの文字にする
const maskReplacer = ({ node, maskValue }) => {
  if (node[BREAK_NODE]) {
    return maskValue(LINE_BREAK)
  }
  if (node.type === 'Code' || node[NOUN_NODE]) {
    return maskValue(MASK)
  }
  return undefined
}
// 報告の文言と allow に使う文字列。伏せ字にしない。
// 改行だけは同じ文字にして、判定に使う文字列と位置を揃える
const breakReplacer = ({ node, maskValue }) =>
  node[BREAK_NODE] ? maskValue(LINE_BREAK) : undefined

/**
 * allow の各要素を正規表現にする。
 * 「/〜/フラグ」の形の文字列はそのフラグで、それ以外の文字列は正規表現の本体として読む。
 */
function compileAllow(allow) {
  if (!Array.isArray(allow)) {
    throw new TypeError(`desumasu-ending: allow は配列である: ${allow}`)
  }
  return allow.map((pattern) => {
    if (pattern instanceof RegExp) {
      return pattern
    }
    if (typeof pattern !== 'string') {
      throw new TypeError(
        `desumasu-ending: allow の要素は文字列か正規表現である: ${pattern}`,
      )
    }
    const literal = /^\/(.+)\/([a-z]*)$/s.exec(pattern)
    try {
      return literal ? new RegExp(literal[1], literal[2]) : new RegExp(pattern)
    } catch (error) {
      throw new SyntaxError(
        `desumasu-ending: allow に読めない正規表現がある: ${pattern}（${error.message}）`,
      )
    }
  })
}

/**
 * オプションを読む。
 * 型の違う値や知らない名前は、黙って無視せずに止める。
 * 「"false"」と引用符付きで書いたり、名前を書き損じたりすると、意図と逆の動きのまま気付けないためである。
 */
function readOptions(rawOptions) {
  const given = rawOptions && typeof rawOptions === 'object' ? rawOptions : {}
  for (const name of Object.keys(given)) {
    if (!Object.hasOwn(DEFAULT_OPTIONS, name) && !TEXTLINT_OPTION_NAMES.has(name)) {
      throw new TypeError(
        `desumasu-ending: 知らないオプションである: ${name}（使えるのは ${Object.keys(DEFAULT_OPTIONS).join('、')}）`,
      )
    }
  }
  const options = { ...DEFAULT_OPTIONS, ...given }
  for (const name of BOOLEAN_OPTIONS) {
    if (typeof options[name] !== 'boolean') {
      throw new TypeError(
        `desumasu-ending: ${name} は true か false である: ${JSON.stringify(options[name])}`,
      )
    }
  }
  return { ...options, allow: compileAllow(options.allow) }
}

// g や y のフラグが付いた正規表現は、test のたびに lastIndex が進み、結果が揺れる。
// 毎回、頭から当てる
function matches(pattern, text) {
  pattern.lastIndex = 0
  return pattern.test(text)
}

// 節の中の文字列をつなげる
function textOf(node) {
  if (typeof node.value === 'string') {
    return node.value
  }
  return (node.children || []).map(textOf).join('')
}

// URL をそのまま書いたもの（裸の URL）か
function isBareUrl(node) {
  const url = node.url || ''
  const text = textOf(node)
  return text === url || url === `mailto:${text}` || url.endsWith(`://${text}`)
}

/**
 * 文字列そのものを判定から外すリンクか。
 * ページ内リンク（目次のように見出しを写したもの）と、URL をそのまま書いたもの（自動リンク、裸の URL）である。
 * 見出しは見ないので、見出しを写した文字列も見ない。URL の末尾は文末ではない。
 */
function isOpaqueLink(node) {
  if (node.type !== 'Link') {
    return false
  }
  return (node.url || '').startsWith('#') || node.raw.startsWith('<') || isBareUrl(node)
}

/**
 * 裸の URL の文字列のうち、URL とみなす先頭の長さを返す。
 * Markdown（GFM）の解析は、空白が来るまでを URL として取り込む。
 * 「（https://…）。」の「）。」や、「https://example.comを参照する。」の「を参照する。」も URL に入る。
 * ASCII の文字と、「/」「#」「?」「=」「&」の直後から続く日本語（「…/wiki/日本語」「…#見出し」）までを URL とみなし、
 * 全角の記号か、区切りの無いところで始まる日本語から後ろは、書き手の文として残す。
 */
function urlPrefixLength(text) {
  let inPath = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch <= '\x7f') {
      inPath = false
      continue
    }
    if (/[\p{P}\p{S}]/u.test(ch)) {
      return i
    }
    if (!inPath) {
      if (!/[/#?=&]/.test(text[i - 1] || '')) {
        return i
      }
      inPath = true
    }
  }
  return text.length
}

/**
 * 節を写し、その中の文字列を伏せ字にする印を付ける。
 * bareUrl が真なら、Str のうち URL とみなす先頭だけを伏せる（urlPrefixLength）。
 */
function markNoun(node, bareUrl = false) {
  if (IMAGE_TYPES.has(node.type)) {
    return [{ ...node, value: node.alt || '', [NOUN_NODE]: true }]
  }
  if (node.children) {
    return [{ ...node, children: node.children.flatMap((child) => markNoun(child, bareUrl)) }]
  }
  if (typeof node.value !== 'string') {
    return [node]
  }
  const length = bareUrl && node.value === node.raw ? urlPrefixLength(node.value) : node.value.length
  if (length === node.value.length) {
    return [{ ...node, [NOUN_NODE]: true }]
  }
  const head = node.value.slice(0, length)
  const tail = node.value.slice(length)
  const split = node.range[0] + length
  return [
    { ...node, value: head, raw: head, range: [node.range[0], split], [NOUN_NODE]: true },
    { ...node, value: tail, raw: tail, range: [split, node.range[1]] },
  ]
}

// 中身を空にした写し。<sup> の中身（注の番号）に使う
function emptied(node) {
  return node.children ? { ...node, children: [] } : { ...node, value: '' }
}

/**
 * 文字列にする前の写しを作る。元の節は書き換えない（ほかの規則も同じ節を見るため）。
 * - 強い改行（行末の空白2つ）と <br> は、断片の区切りにする
 * - 画像の代替テキスト、ページ内リンクと自動リンクの文字列は、伏せ字にする
 * - <sup>〜</sup> の中身（「設定を変える<sup>1</sup>。」の「1」）は、文末の注記として外す
 */
function prepare(node) {
  if (node.type === 'Break') {
    return { ...node, value: node.raw, [BREAK_NODE]: true }
  }
  if (node.type === 'Html' && /^<br\s*\/?>$/i.test(node.value)) {
    // 型を変えて、textlint-util-to-string が HTML として捨てないようにする
    return { ...node, type: 'HtmlBreak', value: node.raw, [BREAK_NODE]: true }
  }
  if (IMAGE_TYPES.has(node.type) || isOpaqueLink(node)) {
    const bareUrl = node.type === 'Link' && !node.raw.startsWith('<') && isBareUrl(node)
    return markNoun(node, bareUrl)[0]
  }
  if (!node.children) {
    return node
  }
  let inSup = false
  const children = node.children.map((child) => {
    if (child.type === 'Html' && /^<sup\b[^>]*>$/i.test(child.value)) {
      inSup = true
      return child
    }
    if (child.type === 'Html' && /^<\/sup\s*>$/i.test(child.value)) {
      inSup = false
      return child
    }
    return inSup ? emptied(child) : prepare(child)
  })
  return { ...node, children }
}

/**
 * 塊の中身がリンクか画像だけか（前後は空白か記号）。
 * 「- [設定を変える](https://…)」のように並べたリンクの文字列は、ページの名前であって書き手の文ではない。
 */
function isOnlyLinks(node) {
  let links = 0
  for (const child of node.children || []) {
    if (LINK_TYPES.has(child.type) || IMAGE_TYPES.has(child.type)) {
      links++
    } else if (
      child.type !== 'Break' &&
      !(child.type === 'Str' && /^[\s\p{P}\p{S}]*$/u.test(child.value))
    ) {
      return false
    }
  }
  return links > 0
}

// 塊の中の Str の節を集める。位置を元の文字列に戻すときに使う
function collectStr(node, out = []) {
  if (node.type === 'Str') {
    out.push(node)
  }
  for (const child of node.children || []) {
    collectStr(child, out)
  }
  return out
}

/**
 * Str の value の位置を、raw の位置に直す。
 * 箇条書きの続きの行では、value から字下げが落ちている（raw は「項目\n  続き」、value は「項目\n続き」）。
 * textlint-util-to-string は両者を同じ長さとして対応づけるため、続きの行の位置が字下げの分だけ前にずれる。
 * value と raw を先頭から突き合わせ、raw にだけある文字（字下げ、エスケープの「\」）を飛ばす。
 */
function rawOffset(str, k) {
  const { value, raw } = str
  let v = 0
  let r = 0
  while (v < k && r < raw.length) {
    if (value[v] === raw[r]) {
      v++
    }
    r++
  }
  while (r < raw.length && raw[r] !== value[k]) {
    r++
  }
  return r
}

/**
 * かっこと引用の記号の対を、文字列の全体で決める。
 * 対になる閉じが無い開き（閉じ忘れ）は、記号としてだけ扱う。
 * 段落の中で改行をまたいだ「「〜。\n〜。」」も、1つの引用として扱える。
 * @returns {{ closeOf: Map<number, number>, openOf: Map<number, number> }}
 */
function matchBrackets(text) {
  const closeOf = new Map()
  const openOf = new Map()
  const stack = []
  const findOpen = (accepts) => {
    for (let k = stack.length - 1; k >= 0; k--) {
      if (accepts(stack[k].ch)) {
        return k
      }
    }
    return -1
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    let k
    if (ch === SYMMETRIC_QUOTE) {
      k = findOpen((c) => c === SYMMETRIC_QUOTE)
      if (k < 0) {
        stack.push({ ch, i })
        continue
      }
    } else if (QUOTE_OPENERS.has(ch) || PAREN_OPENERS.has(ch)) {
      stack.push({ ch, i })
      continue
    } else if (OPENERS_OF.has(ch)) {
      const openers = OPENERS_OF.get(ch)
      k = findOpen((c) => openers.has(c))
      if (k < 0) {
        continue
      }
    } else {
      continue
    }
    // 間に残った開き（閉じ忘れ）は捨てる
    const open = stack[k]
    stack.length = k
    closeOf.set(open.i, i)
    openOf.set(i, open.i)
  }
  return { closeOf, openOf }
}

const isDigit = (ch) => ch !== undefined && /[0-9０-９]/.test(ch)

// i の文字で文が終わるか
function isTerminator(text, i) {
  const ch = text[i]
  if (ch === '．') {
    // 「２．０」のような数の中の点では区切らない
    return !(isDigit(text[i - 1]) && isDigit(text[i + 1]))
  }
  if (TERMINATORS.has(ch)) {
    return true
  }
  if (HALF_TERMINATORS.has(ch)) {
    const next = text[i + 1]
    return (
      next === undefined ||
      /\s/.test(next) ||
      QUOTE_CLOSERS.has(next) ||
      PAREN_CLOSERS.has(next) ||
      TERMINATOR_CHARS.has(next)
    )
  }
  return false
}

// i から改行して見せる記号が始まるなら、その長さを返す。
// 行末の「\」（強い改行）は、textlint の Markdown の解析では Str の中に「\」と改行のまま残る
function hardBreakLength(text, i) {
  if (text[i] === LINE_BREAK) {
    return 1
  }
  return text[i] === '\\' && text[i + 1] === '\n' ? 2 : 0
}

/**
 * 文に割る。句点の位置は含めない。
 * 「。」の無い末尾と、強い改行や <br> の前の部分は、断片（terminated: false）として返す。
 * @param {string} text
 * @param {{ closeOf: Map<number, number>, openOf: Map<number, number> }} brackets
 * @param {number} from
 * @param {number} to
 */
function splitSentences(text, brackets, from = 0, to = text.length) {
  const sentences = []
  let start = from
  // かっこを開いた時点の、外側の文の始まり
  const outerStarts = []
  for (let i = from; i < to; i++) {
    const ch = text[i]
    const close = brackets.closeOf.get(i)
    if (close !== undefined && close < to) {
      if (QUOTE_OPENERS.has(ch)) {
        // 引用の内側は見ない
        i = close
      } else {
        outerStarts.push(start)
        start = i + 1
      }
      continue
    }
    if (brackets.openOf.has(i) && PAREN_CLOSERS.has(ch)) {
      // かっこの中の句点の後ろに残った断片は、注記として見ない。外側の文に戻る
      if (outerStarts.length > 0) {
        start = outerStarts.pop()
      }
      continue
    }
    const breakLength = hardBreakLength(text, i)
    if (breakLength > 0) {
      sentences.push({ start, end: i, terminated: false })
      start = i + breakLength
      i = start - 1
      continue
    }
    if (isTerminator(text, i)) {
      // 「！？」のように続く記号は、まとめて1つの区切りとする
      let j = i
      while (j + 1 < to && TERMINATOR_CHARS.has(text[j + 1])) {
        j++
      }
      sentences.push({ start, end: i, terminated: true })
      start = j + 1
      i = j
    }
  }
  if (outerStarts.length > 0) {
    start = outerStarts[0]
  }
  if (start < to) {
    sentences.push({ start, end: to, terminated: false })
  }
  return sentences
}

/**
 * 文末の空白、かっこの注記、参照の印を外した位置を返す。
 * 「〜します（4.10）」の「（4.10）」、「〜です【未確認】」の「【未確認】」、「〜がある※1」の「※1」である。
 */
function stripTail(text, start, end, brackets) {
  let e = end
  for (;;) {
    while (e > start && /\s/.test(text[e - 1])) {
      e--
    }
    if (e <= start) {
      return e
    }
    const mark = TRAILING_MARK.exec(text.slice(start, e))
    if (mark) {
      e -= mark[0].length
      continue
    }
    // 対が無いかっこは記号として残す。記号で終わる文は報告しない
    const open = brackets.openOf.get(e - 1)
    if (open === undefined || open < start || !PAREN_CLOSERS.has(text[e - 1])) {
      return e
    }
    e = open
  }
}

/**
 * 文の全体が1組のかっこで囲まれていれば、その内側の範囲を返す（表のセルの「（後で決める）」）。
 */
function innerOfWholeParen(text, start, end, brackets) {
  let s = start
  let e = end
  while (s < e && /\s/.test(text[s])) {
    s++
  }
  while (e > s && /\s/.test(text[e - 1])) {
    e--
  }
  if (PAREN_OPENERS.has(text[s]) && brackets.closeOf.get(s) === e - 1) {
    return { start: s + 1, end: e - 1 }
  }
  return null
}

// 文末に付く終助詞（「〜ですか」の「か」、「〜ますね」の「ね」）。
// 「け」は含めない。kuromoji は「（〜）だけ」を「だ」と終助詞「け」に割ることがあるためである
function isSentenceEndParticle(token) {
  return (
    token.pos === '助詞' &&
    token.surface_form !== 'け' &&
    token.pos_detail_1.includes('終助詞')
  )
}

function isConjunctiveParticle(token) {
  return token.pos === '助詞' && token.pos_detail_1 === '接続助詞'
}

// 述語の一部か。
// 「つ」は除く。kuromoji は「次の3つ」の「つ」を文語の助動詞とすることがあるためである
function isPredicate(token) {
  if (token.pos === '助動詞') {
    return token.surface_form !== 'つ'
  }
  return token.pos === '動詞' || token.pos === '形容詞'
}

// 述語の連なりの中で、述語どうしをつなぐ助詞（「している」の「て」）
function isJoiningParticle(token) {
  return (
    isConjunctiveParticle(token) &&
    (token.surface_form === 'て' || token.surface_form === 'で')
  )
}

// kuromoji は「〜による」「〜に当たる」を1語の格助詞（連語）とする。
// 動詞の形で終わるものは、文末では述語として扱う
function isVerbLikeParticle(token) {
  return (
    token.pos === '助詞' &&
    token.pos_detail_2 === '連語' &&
    /[うくぐすつぬぶむる]$/.test(token.surface_form)
  )
}

// 「〜のか」「〜んだ」の「の」「ん」（名詞・非自立）
function isNominalizer(token) {
  return (
    token.pos === '名詞' &&
    token.pos_detail_1 === '非自立' &&
    (token.surface_form === 'の' || token.surface_form === 'ん')
  )
}

function isPolite(token) {
  return (
    (token.pos === '助動詞' && POLITE_AUXILIARIES.has(token.basic_form)) ||
    (token.pos === '動詞' &&
      POLITE_VERBS.has(token.basic_form) &&
      token.conjugated_form === '命令ｉ')
  )
}

/**
 * 最後の述語が文を言い切る形か。
 * @param {object} token 最後の述語
 * @param {{ terminated: boolean, nominalized: boolean }} context
 */
function isTerminalForm(token, { terminated, nominalized }) {
  if (TERMINAL_FORMS.has(token.conjugated_form)) {
    return true
  }
  if (token.conjugated_form === '体言接続') {
    // 「べき」は体言接続の形で文を終える。
    // 「だ」の体言接続の「な」（「簡単な」「〜のような」）は、名詞にかかる形であって文末ではない。
    // ただし「〜なのか」のように「の」で受けたものは、文末の述語である
    return token.basic_form === 'べし' || nominalized
  }
  // 「これを使わず。」の「ず」。句点で終わる文では言い切りとして扱う。
  // 断片の「〜せず」は、連用形と同じく言い切っていない形として扱う
  return (
    terminated &&
    token.pos === '助動詞' &&
    token.basic_form === 'ぬ' &&
    token.surface_form === 'ず'
  )
}

/**
 * 普通体の文末なら、その述語の連なりの位置（トークンの番号）を返す。
 * 丁寧な文末、体言止め、記号で終わるものは null を返す。
 * @param {object[]} tokens
 * @param {boolean} terminated 句点などで終わる文か（false なら断片）
 */
function findPlainEnding(tokens, terminated) {
  let i = tokens.length - 1
  let stripped = false
  while (i >= 0 && isSentenceEndParticle(tokens[i])) {
    // 断片の末尾の「か」は、間接疑問（「WebPを書き出せるか」）として名詞のように置かれることが多い。
    // 「書き出せますか」に直すと、直接の問いになり意味が変わる
    if (!terminated && tokens[i].surface_form === 'か') {
      return null
    }
    stripped = true
    i--
  }
  if (i < 0) {
    return null
  }
  if (isConjunctiveParticle(tokens[i])) {
    // 断片の「保存すると」「保存するので」は、表の左の列に置いた条件のような、言い切っていない形である
    if (!terminated || !TRAILING_CONJUNCTIVES.has(tokens[i].surface_form)) {
      return null
    }
    i--
    if (i < 0) {
      return null
    }
  }
  // 「〜するのか」「〜なのか」の「の」は名詞・非自立になる。飛ばして、その前の述語を見る
  let nominalized = false
  if (stripped && i > 0 && isNominalizer(tokens[i]) && isPredicate(tokens[i - 1])) {
    nominalized = true
    i--
  }
  const last = i
  if (isVerbLikeParticle(tokens[last])) {
    return { from: last, last: tokens.length - 1 }
  }

  // 述語の連なり（動詞、形容詞、助動詞と、それをつなぐ「て」「で」）を後ろから集める
  let hasPredicate = false
  let polite = false
  for (; i >= 0; i--) {
    const token = tokens[i]
    if (isPredicate(token)) {
      hasPredicate = true
      polite ||= isPolite(token)
    } else if (!isJoiningParticle(token)) {
      break
    }
  }

  if (!hasPredicate || polite) {
    return null
  }
  if (!isTerminalForm(tokens[last], { terminated, nominalized })) {
    return null
  }
  return { from: i + 1, last: tokens.length - 1 }
}

/**
 * トークンの位置（body の中の UTF-16 の位置）を求める。
 * kuromoji の word_position はコードポイント単位で数えるため、絵文字や「𠮷」のような
 * サロゲートペアがあると、UTF-16 で数える文字列の位置とずれる。表層形を先頭から探して求める。
 */
function tokenOffsets(body, tokens) {
  const offsets = []
  let cursor = 0
  for (const token of tokens) {
    const found = body.indexOf(token.surface_form, cursor)
    const at = found === -1 ? cursor : found
    offsets.push(at)
    cursor = at + token.surface_form.length
  }
  return offsets
}

function hasAncestor(node, type) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === type) {
      return true
    }
  }
  return false
}

module.exports = function desumasuEnding(context, rawOptions) {
  const { Syntax, RuleError, report, locator } = context
  const options = readOptions(rawOptions)

  /**
   * 1つの塊（段落か表のセル）を見る。
   * @param {object} node 段落か表のセル
   * @param {boolean} checkFragments 「。」の無い断片の末尾も見るか
   */
  async function check(node, checkFragments) {
    const prepared = prepare(node)
    const masked = new StringSource(prepared, { replacer: maskReplacer })
    const text = masked.toString()
    // allow と報告の文言には、伏せる前の文字列を使う。
    // 伏せ字は同じ長さなので、位置はそのまま対応する
    const plainSource = new StringSource(prepared, { replacer: breakReplacer }).toString()
    const plain = plainSource.length === text.length ? plainSource : text
    const brackets = matchBrackets(text)
    const fragments = checkFragments && !isOnlyLinks(node)
    const strNodes = collectStr(node)

    // StringSource が返す位置（塊の先頭から数える）を、字下げを含む元の文字列の位置に直す
    const toOriginal = (relative) => {
      if (relative === undefined) {
        return undefined
      }
      const absolute = node.range[0] + relative
      const str = strNodes.find((s) => s.range[0] <= absolute && absolute < s.range[1])
      if (!str || str.value === str.raw) {
        return relative
      }
      const k = absolute - str.range[0]
      if (k >= str.value.length) {
        return relative
      }
      return str.range[0] + rawOffset(str, k) - node.range[0]
    }

    async function examine(sentence) {
      if (!sentence.terminated && !fragments) {
        return
      }
      const end = stripTail(text, sentence.start, sentence.end, brackets)
      const body = text.slice(sentence.start, end)
      if (body.trim() === '') {
        // セルや項目の全体がかっこの中にあるもの（「（後で決める）」）は、内側の末尾を見る。
        // 内側の句点や改行で区切った文は、外側を割ったときに見てある
        const inner = innerOfWholeParen(text, sentence.start, sentence.end, brackets)
        if (inner) {
          const parts = splitSentences(text, brackets, inner.start, inner.end)
          const tail = parts[parts.length - 1]
          if (tail && !tail.terminated && tail.end === inner.end) {
            await examine({ ...tail, terminated: sentence.terminated })
          }
        }
        return
      }
      if (QUOTE_CLOSERS.has(body[body.length - 1])) {
        return
      }
      const whole = plain.slice(sentence.start, sentence.end).trim()
      if (options.allow.some((pattern) => matches(pattern, whole))) {
        return
      }

      const tokens = await tokenize(body)
      const ending = findPlainEnding(tokens, sentence.terminated)
      if (!ending) {
        return
      }

      const offsets = tokenOffsets(body, tokens)
      const tokenStart = (k) => sentence.start + offsets[k]
      const from = tokenStart(ending.from)
      const to = tokenStart(ending.last) + tokens[ending.last].surface_form.length

      // 文言には、述語の1つ前の語まで含めて見せる（「〜はない」「〜を確かめる」）
      const before = tokens[ending.from - 1]
      const excerptFrom =
        before && before.pos !== '記号' ? tokenStart(ending.from - 1) : from
      const excerpt = plain.slice(excerptFrom, to).replace(/\s+/g, ' ')
      const lead = plain.slice(sentence.start, excerptFrom).trim() ? '〜' : ''

      const originalFrom = toOriginal(masked.originalIndexFromIndex(from))
      const originalLast = toOriginal(masked.originalIndexFromIndex(to - 1))
      const padding =
        originalFrom !== undefined && originalLast !== undefined
          ? { padding: locator.range([originalFrom, originalLast + 1]) }
          : {}
      report(
        node,
        new RuleError(
          `文末が普通体です（${lead}${excerpt}）。ですます調で書きます`,
          padding,
        ),
      )
    }

    for (const sentence of splitSentences(text, brackets)) {
      await examine(sentence)
    }
  }

  return {
    async [Syntax.Paragraph](node) {
      if (hasAncestor(node, Syntax.BlockQuote)) {
        return
      }
      const inList = node.parent && node.parent.type === Syntax.ListItem
      if (inList && !options.checkList) {
        return
      }
      await check(node, inList && options.checkFragments)
    },
    async [Syntax.TableCell](node) {
      if (!options.checkTable || hasAncestor(node, Syntax.BlockQuote)) {
        return
      }
      // 見出しの行は見ない。「何に使うか」「どうするか」のような列の名前は、文ではない
      const row = node.parent
      const table = row && row.parent
      if (table && table.children[0] === row) {
        return
      }
      await check(node, options.checkFragments)
    },
  }
}
