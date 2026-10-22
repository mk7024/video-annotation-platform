'use client'

import { Download, FileJson, FileSpreadsheet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatDuration } from '@/lib/format'

export type DailyExportItem = {
  date: string
  tasks: number
  ms: number
}

export type TaskDatasetExportItem = {
  task_id: string
  title: string
  tenant_name: string
  annotator_name: string | null
  video_url: string
  submitted_date: string
  effective_ms: number
  segments: Array<{
    start_ms: number
    end_ms: number
    note: string | null
  }>
}

type StatsExportBarProps = {
  daily: DailyExportItem[]
  dataset: TaskDatasetExportItem[]
}

function escapeCsvCell(value: string | number | null | undefined): string {
  const str = String(value ?? '')
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

function triggerDownload(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function StatsExportBar({ daily, dataset }: StatsExportBarProps) {
  const disabled = dataset.length === 0

  function handleExportDailyCsv() {
    const header = [
      '提交日期 (Asia/Shanghai)',
      '已提交任务数',
      '有效时长 (毫秒)',
      '有效时长 (秒)',
      '有效时长 (可读)',
    ]
    const lines = [
      header.map(escapeCsvCell).join(','),
      ...daily.map((d) =>
        [
          d.date,
          d.tasks,
          d.ms,
          (d.ms / 1000).toFixed(1),
          formatDuration(d.ms),
        ]
          .map(escapeCsvCell)
          .join(',')
      ),
    ]
    // 添加 UTF-8 BOM，确保 Excel 直接双击打开中文不乱码
    triggerDownload(
      'daily-effective-workload.csv',
      '\uFEFF' + lines.join('\r\n'),
      'text/csv;charset=utf-8'
    )
  }

  function handleExportDetailCsv() {
    const header = [
      '提交日期',
      '租户',
      '标注员',
      '任务 ID',
      '任务名称',
      '片段数量',
      '有效时长 (毫秒)',
      '有效时长 (可读)',
      '视频链接',
    ]
    const lines = [
      header.map(escapeCsvCell).join(','),
      ...dataset.map((row) =>
        [
          row.submitted_date,
          row.tenant_name,
          row.annotator_name ?? '—',
          row.task_id,
          row.title,
          row.segments.length,
          row.effective_ms,
          formatDuration(row.effective_ms),
          row.video_url,
        ]
          .map(escapeCsvCell)
          .join(',')
      ),
    ]
    triggerDownload(
      'submitted-tasks-detail.csv',
      '\uFEFF' + lines.join('\r\n'),
      'text/csv;charset=utf-8'
    )
  }

  function handleExportDatasetJson() {
    const payload = {
      exported_at: new Date().toISOString(),
      timezone: 'Asia/Shanghai',
      total_submitted_tasks: dataset.length,
      total_effective_ms: dataset.reduce((s, r) => s + r.effective_ms, 0),
      tasks: dataset.map((item) => ({
        task_id: item.task_id,
        title: item.title,
        tenant_name: item.tenant_name,
        annotator_name: item.annotator_name,
        video_url: item.video_url,
        submitted_date: item.submitted_date,
        effective_ms: item.effective_ms,
        segments: item.segments.map((seg, index) => ({
          index: index + 1,
          start_ms: seg.start_ms,
          end_ms: seg.end_ms,
          duration_ms: seg.end_ms - seg.start_ms,
          start_sec: Number((seg.start_ms / 1000).toFixed(3)),
          end_sec: Number((seg.end_ms / 1000).toFixed(3)),
          note: seg.note,
        })),
      })),
    }

    triggerDownload(
      'annotations-dataset.json',
      JSON.stringify(payload, null, 2),
      'application/json;charset=utf-8'
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={handleExportDailyCsv}
      >
        <FileSpreadsheet data-icon="inline-start" />
        导出每日工时 CSV
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={handleExportDetailCsv}
      >
        <Download data-icon="inline-start" />
        导出任务明细 CSV
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={handleExportDatasetJson}
      >
        <FileJson data-icon="inline-start" />
        导出标注数据集 JSON
      </Button>
    </div>
  )
}
