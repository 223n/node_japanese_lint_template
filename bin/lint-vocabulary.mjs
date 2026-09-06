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

function fail(message) {
  process.stderr.write(`lint-vocabulary: ${message}\n`)
  process.exit(2)
}

function parseArgs(argv) {
  const options = { config: null, root: null, format: 'text' }
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
        process.stdout.write(USAGE)
        process.exit(0)
        break
      case '-v':
      case '--version':
        process.stdout.write(`${VERSION}\n`)
        process.exit(0)
        break
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
 */
function collectFiles(target) {
  const found = []
  const walk = (dir) => {
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch (error) {
      process.stderr.write(`lint-vocabulary: 読めないので飛ばす: ${dir}（${error.message}）\n`)
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

/** 中身が文字として読めるかを見る。NUL があれば生成物とみなす */
function readTextFile(file) {
  let stat
  try {
    stat = fs.statSync(file)
  } catch {
    return null
  }
  if (stat.size > MAX_FILE_BYTES) return null
  let buffer
  try {
    buffer = fs.readFileSync(file)
  } catch (error) {
    process.stderr.write(`lint-vocabulary: 読めないので飛ばす: ${file}（${error.message}）\n`)
    return null
  }
  if (buffer.includes(0)) return null
  return buffer.toString('utf8')
}

// ---------------------------------------------------------------- 検査

function checkTarget(target, base) {
  const violations = []
  for (const file of collectFiles(target)) {
    const text = readTextFile(file)
    if (text === null) continue
    const lines = text.split(/\r\n|\r|\n/)
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
          file: path.relative(base, file).split(path.sep).join('/'),
          line: index + 1,
          code: rule.code,
          message: rule.message,
          text: line.trim(),
        })
      }
    }
  }
  return violations
}

// ---------------------------------------------------------------- 出力

function reportText(violations, targets, marker) {
  if (violations.length === 0) {
    process.stdout.write('語彙の検査: 問題ありません\n')
    return
  }
  for (const v of violations) {
    process.stdout.write(`${v.file}:${v.line}  ${v.code} ${v.message}\n`)
    process.stdout.write(`    ${v.text}\n`)
  }
  const markers = [...new Set(targets.map((t) => t.marker))]
  process.stdout.write('\n')
  process.stdout.write(`禁じた語彙が ${violations.length} 件見つかりました。\n`)
  process.stdout.write(
    `表示や記録のためだけに要る行は、その行か直前の行に理由を添えて断ってください（例: ${markers[0] ?? marker}: 理由）。\n`,
  )
}

function reportJson(violations) {
  process.stdout.write(
    `${JSON.stringify({ violationCount: violations.length, violations }, null, 2)}\n`,
  )
}

// ---------------------------------------------------------------- 本体

function main() {
  const options = parseArgs(process.argv.slice(2))
  const configPath = findConfig(options.config)
  const { base, targets } = normalizeConfig(
    loadConfig(configPath),
    configPath,
    options.root,
  )

  const violations = []
  for (const target of targets) {
    if (!fs.existsSync(target.dir)) {
      if (target.optional) continue
      fail(`対象が見つからない: ${target.display}（${target.dir}）`)
    }
    if (!fs.statSync(target.dir).isDirectory()) {
      fail(`対象がディレクトリでない: ${target.display}（${target.dir}）`)
    }
    violations.push(...checkTarget(target, base))
  }

  if (options.format === 'json') {
    reportJson(violations)
  } else {
    reportText(violations, targets, DEFAULT_ALLOW_MARKER)
  }
  process.exit(violations.length > 0 ? 1 : 0)
}

main()
