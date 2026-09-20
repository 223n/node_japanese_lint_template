'use strict'

const path = require('node:path')

// 日本語の検査規則。textlint が読む。
//
// 素の preset をそのまま当てると、日本語の技術文書と噛み合わない指摘が出る。
// 切った規則、ゆるめた規則には、なぜそうしたかを必ず書く。
// 理由の書けない除外を増やさないためである。
//
// severity を warning にした規則は、直すべきだが今すぐ止める理由もないものである。
// textlint は error だけで終了コードを 1 にするため、警告は検査を通しつつ目に入る。

// テキスト校正くん（VS Code 拡張 ics.japanese-proofreading）が使う校正辞書。
// 辞書の名前は、その拡張の設定画面に並ぶ名前と揃えてある。
// 辞書そのものは dict/ に同梱している。出典と許諾は dict/README.md に書いた。
const PROOFREADING_DICTIONARIES = {
  誤字: 'prh_idiom.yml',
  重言: 'prh_duplicate.yml',
  ひらく漢字: 'prh_open_close.yml',
  冗長な表現: 'prh_redundancy.yml',
  外来語カタカナ表記: 'prh_cho_on.yml',
  固有名詞: 'prh_corporation.yml',
  技術用語: 'prh_web_technology.yml',
}

const DICT_DIR = path.join(__dirname, '..', 'dict')

/**
 * textlint の設定を作る。
 *
 * @param {object} [options] 設定を変えるところ
 * @param {'である'|'ですます'} [options.style]
 *   文体。既定は「である」。
 * @param {number} [options.sentenceLength]
 *   一文の最大文字数。既定は 120。
 *   一文一行で書くと一文が長くなるため、preset の既定（100）では収まらない文がある。
 * @param {number|false} [options.maxKanjiContinuousLen]
 *   漢字を連ねてよい上限。既定は 6（preset の既定と同じ）。false にすると規則そのものを切る。
 * @param {boolean} [options.strictSentenceEnd]
 *   文末の句点を厳しく見るか。既定は false。
 * @param {boolean} [options.jtfStyle]
 *   日本翻訳連盟のスタイルガイド（preset-jtf-style）を当てるか。既定は true。
 *   37 の規則が一度に有効になるため、指摘が多すぎる場合は false にする。
 * @param {'never'|'always'|false} [options.halfWidthSpacing]
 *   全角と半角の間のスペース。既定は 'never'（入れない）。
 *   'always' にすると入れることを求め、false にすると規則そのものを切る。
 *   コードスパン・リンク・スラッシュの前後は、この設定に関係なく入れないことを求める。
 * @param {boolean} [options.proofreading]
 *   テキスト校正くんの校正辞書（誤字・重言・ひらく漢字など）と康煕部首の規則を当てるか。
 *   既定は true。
 * @param {'error'|'warning'} [options.proofreadingSeverity]
 *   校正辞書と康煕部首の指摘の強さ。既定は 'warning'。
 * @param {string[]} [options.proofreadingDictionaries]
 *   当てる辞書の名前。既定は7種すべて。
 *   使える名前は「誤字」「重言」「ひらく漢字」「冗長な表現」「外来語カタカナ表記」
 *   「固有名詞」「技術用語」である。
 * @returns {object} textlint の設定
 */
function createTextlintConfig(options = {}) {
  const style = options.style ?? 'である'
  if (style !== 'である' && style !== 'ですます') {
    throw new Error(`style は「である」か「ですます」である: ${style}`)
  }

  const sentenceLength = options.sentenceLength ?? 120
  // 数でないものを渡すと、規則が黙って効かなくなる。その場で気付けるようにする
  if (!Number.isInteger(sentenceLength) || sentenceLength < 1) {
    throw new Error(`sentenceLength は1以上の整数である: ${sentenceLength}`)
  }

  const maxKanjiContinuousLen = options.maxKanjiContinuousLen ?? 6
  if (
    maxKanjiContinuousLen !== false &&
    (!Number.isInteger(maxKanjiContinuousLen) || maxKanjiContinuousLen < 1)
  ) {
    throw new Error(
      `maxKanjiContinuousLen は1以上の整数か false である: ${maxKanjiContinuousLen}`,
    )
  }

  const strictSentenceEnd = options.strictSentenceEnd ?? false
  const jtfStyle = options.jtfStyle ?? true
  const halfWidthSpacing = options.halfWidthSpacing ?? 'never'
  if (
    halfWidthSpacing !== 'never' &&
    halfWidthSpacing !== 'always' &&
    halfWidthSpacing !== false
  ) {
    throw new Error(
      `halfWidthSpacing は 'never' か 'always' か false である: ${halfWidthSpacing}`,
    )
  }

  const proofreading = options.proofreading ?? true

  const proofreadingSeverity = options.proofreadingSeverity ?? 'warning'
  if (proofreadingSeverity !== 'error' && proofreadingSeverity !== 'warning') {
    throw new Error(
      `proofreadingSeverity は 'error' か 'warning' である: ${proofreadingSeverity}`,
    )
  }

  const dictionaryNames = Object.keys(PROOFREADING_DICTIONARIES)
  const proofreadingDictionaries =
    options.proofreadingDictionaries ?? dictionaryNames
  if (!Array.isArray(proofreadingDictionaries)) {
    throw new Error(
      `proofreadingDictionaries は配列である: ${proofreadingDictionaries}`,
    )
  }
  // 名前を書き損じると、その辞書だけが黙って効かなくなる。その場で気付けるようにする
  for (const name of proofreadingDictionaries) {
    if (!Object.hasOwn(PROOFREADING_DICTIONARIES, name)) {
      throw new Error(
        `proofreadingDictionaries に知らない辞書がある: ${name}（使えるのは ${dictionaryNames.join('、')}）`,
      )
    }
  }
  // 空の配列は「全部切る」の書き方として紛らわしい。切るなら proofreading: false と書く
  if (proofreading && proofreadingDictionaries.length === 0) {
    throw new Error(
      'proofreadingDictionaries が空である。辞書を当てないなら proofreading: false と書く',
    )
  }

  const technicalWriting = {
    // 文体を統一する。preset の既定は「ですます」なので、である調のときは入れ替える。
    'no-mix-dearu-desumasu': {
      preferInHeader: '',
      preferInBody: style,
      preferInList: style,
      strict: false,
    },

    // 一文一行で書くと一文が長くなる。
    'sentence-length': {
      max: sentenceLength,
    },

    // 文末の句点。
    // 「最終更新: 2026-09-04」のような、文ではない行を文とみなして指摘する。
    // 文末の体裁は no-mix-dearu-desumasu が実質的に見ているため、既定では切る。
    'ja-no-mixed-period': strictSentenceEnd,

    // 以下は文章の質に関わる指摘で、直す価値はあるが検査を止めるほどではない。
    // 書き始めの文書に該当箇所が残っていても進めるよう、警告として出す。

    // 助詞の連続。
    'no-doubled-joshi': {
      min_interval: 1,
      severity: 'warning',
    },

    // 漢字の連続。仕様の用語や固有名詞は言い換えられないことがある。
    'max-kanji-continuous-len':
      maxKanjiContinuousLen === false
        ? false
        : { max: maxKanjiContinuousLen, severity: 'warning' },

    // 冗長な表現。
    'ja-no-redundant-expression': {
      severity: 'warning',
    },

    // 不自然なアルファベット。
    'ja-unnatural-alphabet': {
      severity: 'warning',
    },
  }

  // 日本翻訳連盟のスタイルガイド。37 の規則が一度に有効になる。
  // 指摘が多すぎる場合は jtfStyle: false で丸ごと外せる。
  const jtf = {
    // ハイフン。「A-B-C」のようなキーや識別子の書式に使う。
    '4.2.6.ハイフン(-)': false,

    // コロン。「最終更新: 2026-09-04」の形を見出しや前書きで使う。
    '4.2.7.コロン(：)': false,

    // かっこの前後のスペース。
    // 箇条書きの続きの行は2つのスペースで字下げする。
    // その行が全角のかっこで始まると、字下げをかっこの前のスペースとみなして指摘する。
    // さらに --fix が字下げを削り、箇条書きの構造そのものを壊す。
    '3.3.かっこ類と隣接する文字の間のスペースの有無': false,

    // 全角と半角の間のスペース。
    // 同じことを見る規則が preset-ja-spacing にもあり、両方が指摘を出す。
    // こちらは真偽値しか取れず「入れない」しか表せないため、
    // 「入れる」または「見ない」を選んだときは、こちらを切って ja-spacing 側に任せる。
    '3.1.1.全角文字と半角文字の間': halfWidthSpacing === 'never',

    // 文体の混在。
    // この3つは no-mix-dearu-desumasu とまったく同じことを見るが、
    // 寄せ先を設定できず、文書内の多数派に寄せろと指摘する。
    //
    // そのため style を 'ですます' にしても、である調が多く残っている文書では
    // 「である調に寄せろ」と言い続け、no-mix-dearu-desumasu と正反対を指す。
    // 文体を移し替えている最中がまさにその状態であり、そこで矛盾する。
    //
    // 文体の判定は寄せ先を設定できる no-mix-dearu-desumasu 一本に任せる。
    // 1.1.2.見出し（見出しの末尾に句点を付けない）は重ならないので残す。
    '1.1.1.本文': false,
    '1.1.3.箇条書き': false,
    '1.1.5.図表のキャプション': false,
  }

  const spacing = {
    // 上と同じ理由。こちらの規則も箇条書きの字下げを誤って拾う。
    'ja-no-space-around-parentheses': false,

    // ここに挙げていない規則は preset-ja-spacing v3 の既定のまま効く。
    // コードスパン・リンク・スラッシュの前後にはスペースを入れない。
    // 強調と斜体の前後は見ない。

    // 全角と半角の間のスペース。
    // 既定は「入れない」である。
    'ja-space-between-half-and-full-width':
      halfWidthSpacing === false ? false : { space: halfWidthSpacing },
  }

  const rules = {
    'preset-ja-technical-writing': technicalWriting,
    'preset-ja-spacing': spacing,
  }
  if (jtfStyle) {
    rules['preset-jtf-style'] = jtf
  }

  // テキスト校正くんの校正辞書。表記ゆれと誤用を、語の対応表で拾う。
  //
  // preset では拾えない種類の指摘である。preset は文の形（長さ、助詞、文体）を見るが、
  // こちらは「アボガド → アボカド」「Github → GitHub」のように語そのものを見る。
  //
  // textlint からは prh というひとつの規則として動くため、severity は辞書ごとに変えられない。
  // 辞書単位の入り切りは、読み込む rulePaths を絞ることで行う。
  //
  // 既定を warning にしてある。「ひらく漢字」や「外来語カタカナ表記」は書き手の好みに
  // 属する指摘を含み、これで検査を止めると既存の文書が一斉に落ちるためである。
  if (proofreading) {
    rules.prh = {
      rulePaths: proofreadingDictionaries.map((name) =>
        path.join(DICT_DIR, PROOFREADING_DICTIONARIES[name]),
      ),
      severity: proofreadingSeverity,
    }

    // 康煕部首。見た目は同じでも別の文字である漢字（⽤ と 用）を拾う。
    // 検索に掛からない、環境によって化けるといった実害があるが、
    // preset-ja-technical-writing に無い規則なので単体で足す。
    rules['no-kangxi-radicals'] = { severity: proofreadingSeverity }
  }

  return {
    filters: {
      // 文中の textlint-disable コメントで個別に止められるようにする。
      comments: true,
    },
    rules,
  }
}

module.exports = { createTextlintConfig }
