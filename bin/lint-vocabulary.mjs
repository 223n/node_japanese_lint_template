#!/usr/bin/env node
// 禁じた語彙がソースに混入していないかを見る。
//
// 「この判定はこの層に置く」「この呼び出しはここでは使わない」といった、
// 型では表せない取り決めを、語彙の有無で機械的に見るための道具である。
//
// これは語彙の検査であって、値の行き先を追うものではない。
// 書き方を変えれば通ってしまうし、通ったからといって違反が無いことにはならない。
// それでも、目視では見落とす混入を拾う。
//
// 見逃したい行には、その行か直前の行に理由を添えた断りを書く。
//
//   // 検査除外: 表示に使うだけで、保存の可否には関わらない
//
// 理由の無い断りは通さない。

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const VERSION = '1.0.0'

/** 設定ファイルとして探す名前。上から順に見る */
const CONFIG_NAMES = [
  'lint-vocabulary.config.json',
  'lint-vocabulary.config.jsonc',
  '.lint-vocabularyrc.json',
]

/** 断りの語の既定 */
const DEFAULT_ALLOW_MARKER = '検査除外'

/** どの対象でも常に見ないもの */
const ALWAYS_EXCLUDED = new Set(['node_modules', '.git', '.hg', '.svn'])

/** 読まないファイルの大きさ。これを超えるものは生成物とみなす */
const MAX_FILE_BYTES = 2 * 1024 * 1024

const USAGE = `使い方: lint-vocabulary [オプション]

禁じた語彙がソースに混入していないかを見る。

オプション:
  -c, --config <path>   設定ファイル。省略すると次を順に探す
                        ${CONFIG_NAMES.join(', ')}
  -r, --root <path>     対象の起点。設定ファイルのある場所が既定
  -f, --format <name>   出力の形式。text（既定）または json
  -h, --help            この使い方を出す
  -v, --version         版を出す

終了コード:
  0  違反なし
  1  違反あり
  2  設定または対象の誤り
`

// ---------------------------------------------------------------- 引数

/** 設定や対象の誤り。捕まえて終了コード 2 にする */
class UsageError extends Error {}

/**
 * 設定や対象の誤りで止める。
 *
 * process.exit を使わない。パイプ相手の書き込みは非同期で、
 * 書き終わる前に exit すると待ち行列に残った分が捨てられるためである。
 */
function fail(message) {
  throw new UsageError(message)
}

function parseArgs(argv) {
  const options = { config: null, root: null, format: 'text', help: false, version: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const takeValue = () => {
      const value = argv[i + 1]
      if (value === undefined) fail(`${arg} には値が要る`)
      i += 1
      return value
    }
    switch (arg) {
      case '-c':
      case '--config':
        options.config = takeValue()
        break
      case '-r':
      case '--root':
        options.root = takeValue()
        break
      case '-f':
      case '--format':
        options.format = takeValue()
        break
      case '-h':
      case '--help':
        options.help = true
        return options
      case '-v':
      case '--version':
        options.version = true
        return options
      default:
        fail(`知らないオプションである: ${arg}`)
    }
  }
  if (options.format !== 'text' && options.format !== 'json') {
    fail(`--format は text か json である: ${options.format}`)
  }
  return options
}

// ---------------------------------------------------------------- 設定

/**
 * コメント付き JSON を読む。
 * 文字列リテラルの中のスラッシュを消さないよう、状態を持って走査する。
 */
function stripJsonComments(text) {
  let out = ''
  let inString = false
  let inLine = false
  let inBlock = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    const nextCh = text[i + 1]
    if (inLine) {
      if (ch === '\n') {
        inLine = false
        out += ch
      }
      continue
    }
    if (inBlock) {
      if (ch === '*' && nextCh === '/') {
        inBlock = false
        i += 1
      } else if (ch === '\n') {
        out += ch
      }
      continue
    }
    if (inString) {
      out += ch
      if (ch === '\\') {
        out += nextCh ?? ''
        i += 1
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
      out += ch
      continue
    }
    if (ch === '/' && nextCh === '/') {
      inLine = true
      i += 1
      continue
    }
    if (ch === '/' && nextCh === '*') {
      inBlock = true
      i += 1
      continue
    }
    out += ch
  }
  return out
}

function findConfig(explicit) {
  if (explicit) {
    const resolved = path.resolve(explicit)
    if (!fs.existsSync(resolved)) fail(`設定ファイルが見つからない: ${resolved}`)
    return resolved
  }
  for (const name of CONFIG_NAMES) {
    const candidate = path.resolve(process.cwd(), name)
    if (fs.existsSync(candidate)) return candidate
  }
  return fail(
    `設定ファイルが見つからない。次のいずれかを置くか --config で指す\n  ${CONFIG_NAMES.join('\n  ')}`,
  )
}

function loadConfig(configPath) {
  let raw
  try {
    raw = fs.readFileSync(configPath, 'utf8')
  } catch (error) {
    return fail(`設定ファイルを読めない: ${configPath}（${error.message}）`)
  }
  try {
    return JSON.parse(stripJsonComments(raw))
  } catch (error) {
    return fail(`設定ファイルを解釈できない: ${configPath}（${error.message}）`)
  }
}

// ---------------------------------------------------------------- 設定の検査

/**
 * 断りの書式。語のあとにコロン（半角か全角）と、空白でない理由が要る。
 * コメント記号は問わない。言語によって書き方が分かれるためである。
 */
function buildAllowRegexp(marker) {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`${escaped}[ \\t]*[:\uFF1A][ \\t]*\\S`)
}

/** 除外の指定を照合の関数に変える。* と ** を扱う */
function toExcludeMatcher(pattern) {
  if (typeof pattern !== 'string' || pattern === '') {
    fail(`exclude の要素は空でない文字列である: ${pattern}`)
  }
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '\u0000')
    .replace(/\*\*/g, '\u0001')
    .replace(/\*/g, '[^/]*')
    .replace(/\u0000/g, '(?:[^/]+/)*')
    .replace(/\u0001/g, '.*')
  const regexp = new RegExp(`^${source}$`)
  return (relativePath) => regexp.test(relativePath)
}

/**
 * 設定を検める。誤りはその場で止める。
 * 走らせてから気付くより、設定を直すほうが早いためである。
 */
function normalizeConfig(config, configPath, rootOverride) {
  const base = rootOverride
    ? path.resolve(rootOverride)
    : path.dirname(configPath)

  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    fail('設定の最上位はオブジェクトである')
  }
  if (!Array.isArray(config.targets) || config.targets.length === 0) {
    fail('targets に対象を1つ以上書く')
  }

  const globalMarker = config.allowMarker ?? DEFAULT_ALLOW_MARKER
  if (typeof globalMarker !== 'string' || globalMarker.trim() === '') {
    fail('allowMarker は空でない文字列である')
  }

  const targets = config.targets.map((target, index) => {
    const where = `targets[${index}]`
    if (typeof target !== 'object' || target === null || Array.isArray(target)) {
      fail(`${where} はオブジェクトである`)
    }
    if (typeof target.path !== 'string' || target.path === '') {
      fail(`${where}.path に対象のディレクトリを書く`)
    }
    const extensions = target.extensions ?? []
    if (!Array.isArray(extensions)) {
      fail(`${where}.extensions は配列である`)
    }
    for (const ext of extensions) {
      if (typeof ext !== 'string' || !ext.startsWith('.')) {
        fail(`${where}.extensions の要素はドットで始める: ${ext}`)
      }
    }
    if (!Array.isArray(target.rules) || target.rules.length === 0) {
      fail(`${where}.rules に規則を1つ以上書く`)
    }

    const marker = target.allowMarker ?? globalMarker
    if (typeof marker !== 'string' || marker.trim() === '') {
      fail(`${where}.allowMarker は空でない文字列である`)
    }

    const rules = target.rules.map((rule, ruleIndex) => {
      const ruleWhere = `${where}.rules[${ruleIndex}]`
      if (typeof rule !== 'object' || rule === null || Array.isArray(rule)) {
        fail(`${ruleWhere} はオブジェクトである`)
      }
      for (const key of ['code', 'pattern', 'message']) {
        if (typeof rule[key] !== 'string' || rule[key] === '') {
          fail(`${ruleWhere}.${key} に空でない文字列を書く`)
        }
      }
      // POSIX の文字クラスは JavaScript の正規表現では使えない。
      // 黙って一致しなくなるより、その場で気付けるほうがよい
      if (rule.pattern.includes('[[:')) {
        fail(
          `${ruleWhere}.pattern に POSIX の文字クラスがある: ${rule.pattern}\n` +
            '  JavaScript の正規表現で書く（[[:space:]] は空白クラス、[[:alpha:]] は [A-Za-z]）',
        )
      }
      const flags = rule.flags ?? ''
      if (typeof flags !== 'string' || /[^imsu]/.test(flags)) {
        fail(`${ruleWhere}.flags は i m s u だけを使う: ${flags}`)
      }
      let regexp
      try {
        regexp = new RegExp(rule.pattern, flags)
      } catch (error) {
        fail(`${ruleWhere}.pattern が正規表現として読めない: ${error.message}`)
      }
      return { code: rule.code, message: rule.message, regexp }
    })

    return {
      name: typeof target.name === 'string' && target.name ? target.name : target.path,
      dir: path.resolve(base, target.path),
      display: target.path,
      extensions,
      exclude: (target.exclude ?? []).map(toExcludeMatcher),
      optional: target.optional === true,
      marker,
      allowRegexp: buildAllowRegexp(marker),
      rules,
    }
  })

  return { base, targets }
}

// ---------------------------------------------------------------- 走査

/**
 * 対象のディレクトリの下からファイルを集める。
 * シンボリックリンクは辿らない。外へ出てしまい、同じファイルを二度見ることがあるためである。
 *
 * 読めないディレクトリは黙って飛ばさない。
 * 検査していないものを「問題なし」と数えるのが、この道具のいちばんの害だからである。
 */
function collectFiles(target, report) {
  const found = []
  const walk = (dir) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch (error) {
      report.unreadable.push({ path: dir, reason: error.message })
      return
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const full = path.join(dir, entry.name)
      const relative = path.relative(target.dir, full).split(path.sep).join('/')
      if (entry.isDirectory()) {
        if (ALWAYS_EXCLUDED.has(entry.name)) continue
        if (target.exclude.some((match) => match(relative))) continue
        walk(full)
        continue
      }
      if (!entry.isFile()) continue
      if (target.extensions.length > 0) {
        const ext = path.extname(entry.name)
        if (!target.extensions.includes(ext)) continue
      }
      if (target.exclude.some((match) => match(relative))) continue
      found.push(full)
    }
  }
  walk(target.dir)
  return found.sort()
}

/**
 * 中身を文字として読む。
 *
 * 読めたら { text }、読まなかったら { skipped: 理由 }、
 * 読もうとして失敗したら { unreadable: 理由 } を返す。
 * 飛ばしたものは必ず報告する。黙って落とすと検査したつもりになる。
 */
function readTextFile(file) {
  let stat
  try {
    stat = fs.statSync(file)
  } catch (error) {
    return { unreadable: error.message }
  }
  if (stat.size > MAX_FILE_BYTES) {
    return { skipped: `${MAX_FILE_BYTES} バイトを超える（${stat.size} バイト）` }
  }
  let buffer
  try {
    buffer = fs.readFileSync(file)
  } catch (error) {
    return { unreadable: error.message }
  }
  if (buffer.includes(0)) {
    return { skipped: 'NUL 文字を含む。文字として読めない' }
  }
  const text = buffer.toString('utf8')
  // UTF-8 として読めない並びは置換文字になる。
  // Shift-JIS や EUC-JP のソースがこれに当たる。
  // そのまま検査すると規則も断りも当たらず、静かに素通りする
  if (text.includes('�') && !buffer.includes(0xef, 0)) {
    return { skipped: 'UTF-8 として読めない。文字コードを確かめること' }
  }
  return { text }
}

// ---------------------------------------------------------------- 検査

function checkTarget(target, base, report) {
  const violations = []
  const files = collectFiles(target, report)
  let scanned = 0

  for (const file of files) {
    const shown = path.relative(base, file).split(path.sep).join('/')
    const result = readTextFile(file)
    if (result.unreadable !== undefined) {
      report.unreadable.push({ path: shown, reason: result.unreadable })
      continue
    }
    if (result.skipped !== undefined) {
      report.skipped.push({ path: shown, reason: result.skipped })
      continue
    }
    scanned += 1

    const lines = result.text.split(/\r\n|\r|\n/)
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      // 同じ行に断りがあれば、その行はどの規則からも見逃す
      if (target.allowRegexp.test(line)) continue
      // 直前の行の断りも効く。長い行の上に書けるようにするためである
      const previous = index > 0 ? lines[index - 1] : ''
      if (target.allowRegexp.test(previous)) continue
      for (const rule of target.rules) {
        if (!rule.regexp.test(line)) continue
        violations.push({
          target: target.name,
          // パスは文字列として持つ。コロンで分解しないため、パスにコロンがあっても崩れない
          file: shown,
          line: index + 1,
          code: rule.code,
          message: rule.message,
          text: line.trim(),
        })
      }
    }
  }

  report.scanned += scanned
  report.perTarget.push({ name: target.name, display: target.display, scanned })
  return violations
}

// ---------------------------------------------------------------- 出力

function reportText(violations, targets, report) {
  for (const s of report.skipped) {
    process.stderr.write(`lint-vocabulary: 飛ばした: ${s.path}（${s.reason}）\n`)
  }

  if (violations.length === 0) {
    // 何件見たかを必ず言う。
    // 「問題ありません」だけでは、1件も見ていないのか、見て問題が無かったのかが分からない
    process.stdout.write(`語彙の検査: 問題ありません（${report.scanned} 件を検査）\n`)
    return
  }
  for (const v of violations) {
    process.stdout.write(`${v.file}:${v.line}  ${v.code} ${v.message}\n`)
    process.stdout.write(`    ${v.text}\n`)
  }
  const markers = [...new Set(targets.map((t) => t.marker))]
  process.stdout.write('\n')
  process.stdout.write(
    `禁じた語彙が ${violations.length} 件見つかりました（${report.scanned} 件を検査）。\n`,
  )
  process.stdout.write(
    `表示や記録のためだけに要る行は、その行か直前の行に理由を添えて断ってください（例: ${markers[0]}: 理由）。\n`,
  )
}

function reportJson(violations, report) {
  process.stdout.write(
    `${JSON.stringify(
      {
        violationCount: violations.length,
        scannedCount: report.scanned,
        skipped: report.skipped,
        targets: report.perTarget,
        violations,
      },
      null,
      2,
    )}\n`,
  )
}

// ---------------------------------------------------------------- 本体

function run() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    process.stdout.write(USAGE)
    return 0
  }
  if (options.version) {
    process.stdout.write(`${VERSION}\n`)
    return 0
  }

  const configPath = findConfig(options.config)
  const { base, targets } = normalizeConfig(
    loadConfig(configPath),
    configPath,
    options.root,
  )

  const report = { scanned: 0, skipped: [], unreadable: [], perTarget: [] }
  const violations = []

  for (const target of targets) {
    if (!fs.existsSync(target.dir)) {
      if (target.optional) {
        report.perTarget.push({ name: target.name, display: target.display, scanned: 0 })
        continue
      }
      fail(`対象が見つからない: ${target.display}（${target.dir}）`)
    }
    if (!fs.statSync(target.dir).isDirectory()) {
      fail(`対象がディレクトリでない: ${target.display}（${target.dir}）`)
    }
    violations.push(...checkTarget(target, base, report))
  }

  // 読めなかったものがあれば、結果は信用できない。
  // 飛ばして 0 を返すと、検査したつもりのまま通ってしまう
  if (report.unreadable.length > 0) {
    const list = report.unreadable
      .map((u) => `  ${u.path}（${u.reason}）`)
      .join('\n')
    fail(`読めないものがあり、検査を終えられませんでした:\n${list}`)
  }

  // 1件も見ていないのに成功を返さない。設定の間違いを見逃すためである
  const empty = report.perTarget.filter((t) => t.scanned === 0)
  const emptyRequired = empty.filter(
    (t) => !targets.find((x) => x.name === t.name)?.optional,
  )
  if (emptyRequired.length > 0) {
    const list = emptyRequired.map((t) => `  ${t.display}`).join('\n')
    fail(
      `対象に検査できるファイルが1つもありません:\n${list}\n` +
        '  path と extensions と exclude を確かめてください。\n' +
        '  空でよい対象には optional: true を書いてください。',
    )
  }

  if (options.format === 'json') {
    reportJson(violations, report)
  } else {
    reportText(violations, targets, report)
  }
  return violations.length > 0 ? 1 : 0
}

function main() {
  try {
    // process.exit を使わない。パイプ相手の書き込みは非同期で、
    // 書き終わる前に exit すると待ち行列に残った分が捨てられるためである。
    // exitCode を立てて、Node が出し終えてから終わるのに任せる
    process.exitCode = run()
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`lint-vocabulary: ${error.message}\n`)
      process.exitCode = 2
      return
    }
    throw error
  }
}

main()
