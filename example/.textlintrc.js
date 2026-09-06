// 日本語の検査規則。共有設定をそのまま使う。
//
// 文体を「ですます調」にしたい場合は、次のように書き換える。
//   module.exports = require('@223n/lint-config-ja/config/textlint-desumasu.js')
//
// 一部だけ変えたい場合は、作る関数を直に呼ぶ。
//   const { createTextlintConfig } = require('@223n/lint-config-ja/config/textlint-base.js')
//   module.exports = createTextlintConfig({ style: 'ですます', sentenceLength: 100 })
module.exports = require('@223n/lint-config-ja/config/textlint.js')
