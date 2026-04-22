/**
 * Minimal CSV parser tailored to the bulk-import flow in CustomTagsManager.
 *
 * Supported:
 *   - UTF-8 (BOM stripped); CRLF or LF line endings
 *   - Comma separator
 *   - Quoted fields ("..."), with "" escaping a literal double quote inside
 *   - Blank lines ignored
 *
 * Not supported (intentionally, to keep the parser small):
 *   - Tab or semicolon separators
 *   - Embedded newlines inside quoted fields
 *
 * Header row is required; headers are lowercased + trimmed so `Name`,
 * `NAME`, `name ` all map to the same key.
 */

export interface ParsedCsv {
  headers: string[]
  rows: Array<Record<string, string>>
}

/**
 * Parse a single CSV line into string cells, honouring double-quoted
 * fields and the "" → " escape. Trailing whitespace in each cell is
 * trimmed; quotes that wrap a whole field are stripped.
 */
function parseLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out.map((c) => c.trim())
}

export function parseCsv(text: string): ParsedCsv {
  // Strip UTF-8 BOM if present so headers match expectations.
  const clean = text.replace(/^﻿/, '')
  const lines = clean.split(/\r?\n/).filter((l) => l.trim() !== '')
  if (lines.length === 0) return { headers: [], rows: [] }
  const headers = parseLine(lines[0]).map((h) => h.toLowerCase())
  const rows: Array<Record<string, string>> = []
  for (let i = 1; i < lines.length; i++) {
    const cells = parseLine(lines[i])
    const record: Record<string, string> = {}
    for (let j = 0; j < headers.length; j++) {
      record[headers[j]] = cells[j] ?? ''
    }
    rows.push(record)
  }
  return { headers, rows }
}

/**
 * Builds a small example CSV (headers + two sample rows) so users can
 * download a template to fill in.
 */
export function buildCustomTagsCsvTemplate(): string {
  // group uses `/` to express nested folders.
  return [
    'name,desc,unit,type,group',
    'FIC-1001.PV,1号反应釜进料流量,m3/h,Analog,生产线 A/反应釜',
    'TC-2001.PV,2号反应釜温度,°C,Analog,生产线 A/反应釜',
    'PMP-101.STS,1号泵状态,,Digital,生产线 A/水泵'
  ].join('\n')
}
