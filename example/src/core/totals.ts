// 中核層の見本。
// 判定と集計はここに置く。表示の都合を知らない。

export function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0)
}

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

export function isValidLabel(label: string): boolean {
  const trimmed = label.trim()
  return trimmed.length > 0 && trimmed.length <= 40
}
