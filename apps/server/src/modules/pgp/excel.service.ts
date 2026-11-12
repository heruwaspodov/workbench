import ExcelJS from 'exceljs'
import type { PlanItem } from '../../db/schema'

const STATUS_LABEL: Record<PlanItem['status'], string> = {
  not_started: 'Not Started', on_track: 'On Track', at_risk: 'At Risk', done: 'Done', not_achieved: 'Not Achieved',
}

const richPlain = (t: unknown): string =>
  typeof t === 'string' ? t : t && typeof t === 'object' && 'richText' in t ? (t as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join('') : t == null ? '' : String(t)

/** Hidden target of an Excel hyperlink cell ("text" shown, URL behind it). */
const cellLink = (cell: ExcelJS.Cell): string => {
  const v = cell.value
  return v && typeof v === 'object' && 'hyperlink' in v && typeof v.hyperlink === 'string' ? v.hyperlink : ''
}

const cellText = (cell: ExcelJS.Cell): string => {
  // Mirror Google Sheets semantics: merged ranges only carry a value in the top-left cell.
  if (cell.isMerged && cell.master.address !== cell.address) return ''
  const v = cell.value
  if (v == null) return ''
  if (typeof v === 'number') {
    return cell.numFmt?.includes('%') ? `${Math.round(v * 10000) / 100}%` : String(v)
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((r) => r.text).join('')
    if ('result' in v) return v.result == null ? '' : String(v.result)
    if ('text' in v) return richPlain(v.text)
  }
  return String(v)
}

interface ExportPlan {
  division: string | null
  sbu: string | null
  sbuDetail: string | null
  directLeader: string | null
  status: string
  user: { name: string }
  period: string
  items: PlanItem[]
  totalWeight: number
  score: number
}

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC9D7F8' } }
const PROGRESS_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0D7EE' } }
const thin: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFBFBFBF' } }, bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } },
  left: { style: 'thin', color: { argb: 'FFBFBFBF' } }, right: { style: 'thin', color: { argb: 'FFBFBFBF' } },
}

export abstract class ExcelService {
  static async readWorkbook(buffer: ArrayBuffer): Promise<Map<string, string[][]>> {
    const out = new Map<string, string[][]>()
    for (const [name, sheet] of await this.readWorkbookWithLinks(buffer)) out.set(name, sheet.rows)
    return out
  }

  /** Cell text plus a same-shaped grid of hyperlink targets (empty string where a cell has none). */
  static async readWorkbookWithLinks(buffer: ArrayBuffer): Promise<Map<string, { rows: string[][]; links: string[][] }>> {
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buffer)
    const out = new Map<string, { rows: string[][]; links: string[][] }>()
    wb.eachSheet((ws) => {
      const rows: string[][] = []
      const links: string[][] = []
      for (let r = 1; r <= Math.min(ws.rowCount, 300); r++) {
        const row = ws.getRow(r)
        const cells: string[] = []
        const urls: string[] = []
        for (let c = 1; c <= Math.min(ws.columnCount, 26); c++) {
          const cell = row.getCell(c)
          cells.push(cellText(cell))
          urls.push(cellLink(cell))
        }
        rows.push(cells)
        links.push(urls)
      }
      out.set(ws.name, { rows, links })
    })
    return out
  }

  /** Exports a plan in the same shape as the management growth-plan sheet. */
  static async exportPlan(plan: ExportPlan): Promise<Buffer> {
    const wb = new ExcelJS.Workbook()
    wb.creator = 'Workbench'
    const ws = wb.addWorksheet(plan.period.replace(/[\\/*?:[\]]/g, '-').slice(0, 31))
    ws.columns = [
      { width: 24 }, { width: 28 }, { width: 36 }, { width: 11 }, { width: 52 },
      { width: 14 }, { width: 14 }, { width: 18 }, { width: 14 }, { width: 14 }, { width: 50 },
    ]

    ws.addRow(['Division Name', 'Your Name', 'SBU (Scope Product)', 'SBU (Detail)', 'Direct Leader', 'Period', 'Status'])
    ws.addRow([plan.division ?? '', plan.user.name, plan.sbu ?? '', plan.sbuDetail ?? '', plan.directLeader ?? '', plan.period, plan.status])
    ws.getRow(1).font = { bold: true }
    ws.getRow(1).eachCell((c) => { c.fill = HEADER_FILL; c.border = thin })
    ws.addRow([])

    const header = ws.addRow([
      "Company OKR / Leader's OKR", 'Objective', 'Key Results', 'Weightage', 'Initiatives',
      'Start Value (baseline)', 'Target Value', 'Current Value', '% Achievement', 'Status', 'Evidence / Links',
    ])
    header.font = { bold: true }
    header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    header.eachCell((c, col) => { c.fill = col >= 6 ? PROGRESS_FILL : HEADER_FILL; c.border = thin })

    const first = header.number + 1
    for (const i of plan.items) {
      const row = ws.addRow([
        i.companyOkr ?? '', i.objective, i.keyResult, i.weight / 100, i.initiative,
        i.startValue ?? '', i.targetValue ?? '', i.currentValue ?? '',
        i.achievement == null ? '' : i.achievement / 100, STATUS_LABEL[i.status], i.evidenceLinks.join('\n'),
      ])
      row.alignment = { vertical: 'top', wrapText: true }
      row.getCell(4).numFmt = '0%'
      row.getCell(9).numFmt = '0%'
      row.eachCell({ includeEmpty: true }, (c) => { c.border = thin })
    }

    // Merge consecutive identical Objective / Key Result cells like the original sheet.
    const mergeRuns = (col: number, keyCols: number[]) => {
      let start = first
      for (let r = first + 1; r <= first + plan.items.length; r++) {
        const same = r < first + plan.items.length &&
          keyCols.every((k) => ws.getCell(r, k).value === ws.getCell(start, k).value) && ws.getCell(start, col).value
        if (!same) {
          if (r - 1 > start) ws.mergeCells(start, col, r - 1, col)
          start = r
        }
      }
    }
    if (plan.items.length) { mergeRuns(2, [2]); mergeRuns(3, [2, 3]) }

    const total = ws.addRow(['', '', 'Total', plan.totalWeight / 100, '', '', '', 'Score', plan.score / 100])
    total.font = { bold: true }
    total.getCell(4).numFmt = '0%'
    total.getCell(9).numFmt = '0.##%'
    ws.views = [{ state: 'frozen', ySplit: header.number }]

    return Buffer.from(await wb.xlsx.writeBuffer())
  }
}
