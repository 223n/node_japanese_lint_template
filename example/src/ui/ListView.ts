// 画面層の見本。
// 表示と入力の受け取りだけを行い、判定と集計は中核層に任せる。

import { sum, isValidLabel, todayKey } from '../core/totals.js'

export function renderTotal(values: number[], at: Date): string {
  const total = sum(values)
  // 検査除外: 見出しに日付を出すだけで、保存の可否には関わらない
  const heading = new Date(at).toLocaleDateString('ja-JP')
  return `${heading} 合計 ${total}`
}

export function onSubmit(label: string): string {
  if (!isValidLabel(label)) {
    return '名前は1文字以上40文字以内で入力してください'
  }
  return `${todayKey()} に追加しました`
}
