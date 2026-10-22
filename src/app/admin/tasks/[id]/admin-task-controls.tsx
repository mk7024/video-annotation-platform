'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Download, RotateCcw, Undo2 } from 'lucide-react'
import {
  adminUnclaimTaskAction,
  reopenTaskAction,
} from '@/app/admin/actions'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import type { SegmentInput, TaskStatus } from '@/lib/types'

type AdminTaskControlsProps = {
  taskId: string
  title: string
  videoUrl: string
  tenantName: string | null
  assigneeName: string | null
  status: TaskStatus
  submittedAt: string | null
  segments: SegmentInput[]
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

export function AdminTaskControls({
  taskId,
  title,
  videoUrl,
  tenantName,
  assigneeName,
  status,
  submittedAt,
  segments,
}: AdminTaskControlsProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleExportJson() {
    const effectiveMs = segments.reduce(
      (sum, s) => sum + (s.endMs - s.startMs),
      0
    )
    const payload = {
      task_id: taskId,
      title,
      tenant_name: tenantName,
      annotator_name: assigneeName,
      video_url: videoUrl,
      status,
      submitted_at: submittedAt,
      effective_ms: status === 'submitted' ? effectiveMs : 0,
      segments: segments.map((s, idx) => ({
        index: idx + 1,
        start_ms: s.startMs,
        end_ms: s.endMs,
        duration_ms: s.endMs - s.startMs,
        start_sec: Number((s.startMs / 1000).toFixed(3)),
        end_sec: Number((s.endMs / 1000).toFixed(3)),
        note: s.note ?? null,
      })),
    }

    triggerDownload(
      `task-${taskId.slice(0, 8)}-segments.json`,
      JSON.stringify(payload, null, 2),
      'application/json;charset=utf-8'
    )
  }

  function handleReopen() {
    const confirmed = window.confirm(
      '确认将该已提交任务「打回重标」吗？\n打回后任务状态将退回“标注中”，当前片段保留为草稿供标注员修改，其有效工时将暂时从统计报表中移除。'
    )
    if (!confirmed) {
      return
    }

    setError(null)
    setNotice(null)

    startTransition(async () => {
      const result = await reopenTaskAction(taskId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setNotice('已打回重标，标注员可继续修改并重新提交')
      router.refresh()
    })
  }

  function handleAdminUnclaim() {
    const confirmed = window.confirm(
      '确认强制回收该任务吗？\n未提交的草稿将被清空，任务将退回该租户的待领取任务池。'
    )
    if (!confirmed) {
      return
    }

    setError(null)
    setNotice(null)

    startTransition(async () => {
      const result = await adminUnclaimTaskAction(taskId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setNotice('已强制回收任务，重新开放领取')
      router.refresh()
    })
  }

  return (
    <div className="mb-4 flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3.5 py-2.5">
        <div className="text-xs text-muted-foreground">
          {status === 'submitted'
            ? '质检与数据交付：可导出当前任务的时间段 JSON，或对不合格标注打回重标。'
            : status === 'claimed'
              ? '异常流转处理：若标注员长期未提交，可强制回收任务回待领取池。'
              : '该任务尚待租户内标注员领取。'}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {segments.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleExportJson}
            >
              <Download data-icon="inline-start" />
              导出片段 JSON
            </Button>
          ) : null}

          {status === 'submitted' ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={isPending}
              onClick={handleReopen}
            >
              <Undo2 data-icon="inline-start" />
              {isPending ? '处理中…' : '打回重标'}
            </Button>
          ) : null}

          {status === 'claimed' ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={handleAdminUnclaim}
            >
              <RotateCcw data-icon="inline-start" />
              {isPending ? '处理中…' : '回收回任务池'}
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {notice ? (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">
          {notice}
        </p>
      ) : null}
    </div>
  )
}
