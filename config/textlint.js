'use strict'

// である調の設定。これが既定である。
// 文体を変えたい場合は textlint-desumasu.js を使うか、
// textlint-base.js の createTextlintConfig を直に呼ぶ。

const { createTextlintConfig } = require('./textlint-base.js')

module.exports = createTextlintConfig()
