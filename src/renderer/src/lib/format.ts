const KB = 1024
const MB = KB * 1024
const GB = MB * 1024

export function formatBytes(n: number | undefined): string {
  if (n == null || !isFinite(n)) return '—'
  if (n < KB) return `${n} B`
  if (n < MB) return `${(n / KB).toFixed(1)} KB`
  if (n < GB) return `${(n / MB).toFixed(1)} MB`
  return `${(n / GB).toFixed(2)} GB`
}

export function formatSpeed(bytesPerSec: number | undefined): string {
  if (bytesPerSec == null || bytesPerSec <= 0) return '—'
  return `${formatBytes(bytesPerSec)}/s`
}

export function formatRows(n: number | undefined): string {
  if (n == null) return '—'
  return n.toLocaleString()
}

export function formatPercent(value: number): string {
  return `${Math.round(value)}%`
}
