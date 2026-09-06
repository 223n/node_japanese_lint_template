// 画面層の見本。
// 表示と入力の受け取りだけを行い、判定と集計は中核層に任せる。

import { summarize, isRecordable, todayKey } from '../core/records.js'

export function renderCounter(records: number[], now: Date): string {
  const total = summarize(records)
  // 検査除外: 表示している日付を出すだけで、記録の可否には関わらない
  const label = new Date(now).toLocaleDateString('ja-JP')
  return `${label} 合計 ${total}`
}

export function onSubmit(day: string, value: number): string {
  if (!isRecordable(day, todayKey())) {
    return '今日より後の日は記録できません'
  }
  return '記録しました'
}
