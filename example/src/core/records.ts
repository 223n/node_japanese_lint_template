// 中核層の見本。
// 判定と集計はここに置く。表示の都合を知らない。

export function summarize(records: number[]): number {
  return records.reduce((a, b) => a + b, 0)
}

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

export function isRecordable(day: string, today: string): boolean {
  return day <= today
}
