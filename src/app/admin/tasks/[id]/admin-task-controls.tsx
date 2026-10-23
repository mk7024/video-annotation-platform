'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Download, RotateCcw, Undo2, UserCheck } from 'lucide-react'
import {
  adminUnclaimTaskAction,
  assignTaskAction,
  reopenTaskAction,
} from '@/app/admin/actions'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import type { SegmentInput, TaskStatus } from '@/lib/types'

type AnnotatorOption = { id: string; name: string }

type AdminTaskControlsProps = {
  taskId: string
  title: string
  videoUrl: string | null
  tenantName: string | null
  assigneeName: string | null
  status: TaskStatus
  submittedAt: string | null
  segments: SegmentInput[]
  annotators: AnnotatorOption[]
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
  annotators,
}: AdminTaskControlsProps) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [assignTo, setAssignTo] = useState(annotators[0]?.id ?? '')
  const [reopenNote, setReopenNote] = useState('')
  const [reopenOpen, setReopenOpen] = useState(false)

  function handleAssign() {
    if (!assignTo) {
      return
    }
    const target = annotators.find((item) => item.id === assignTo)
    const confirmed = window.confirm(
      `确认把该任务直接指派给「${target?.name ?? assignTo}」吗？\n指派后任务立即锁定给该标注员，其他标注员无法再领取。`
    )
    if (!confirmed) {
      return
    }

    setError(null)
    setNotice(null)

    startTransition(async () => {
      const result = await assignTaskAction(taskId, assignTo)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setNotice(`已指派给 ${target?.name ?? '标注员'}，对方可在「我的任务」中继续标注`)
      router.refresh()
    })
  }

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
      video_url: videoUrl ?? null,
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
    const note = reopenNote.trim()
    if (!note) {
      setError('请填写打回原因，标注员需要知道哪里有问题')
      return
    }

    setError(null)
    setNotice(null)

    startTransition(async () => {
      const result = await reopenTaskAction(taskId, note)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setReopenOpen(false)
      setReopenNote('')
      setNotice('已打回重标，标注员会在任务页看到打回原因')
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
      {status === 'unassigned' && annotators.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3.5 py-2.5">
          <div className="text-xs text-muted-foreground">
            指派任务：不等待领取，直接锁定给本租户的某位标注员。
          </div>
          <div className="flex items-center gap-2">
            <select
              value={assignTo}
              onChange={(event) => setAssignTo(event.target.value)}
              aria-label="选择要指派给的标注员"
              className="h-8 w-40 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            >
              {annotators.map((annotator) => (
                <option key={annotator.id} value={annotator.id}>
                  {annotator.name}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              disabled={isPending || !assignTo}
              onClick={handleAssign}
            >
              <UserCheck data-icon="inline-start" />
              {isPending ? '指派中…' : '指派任务'}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3.5 py-2.5">
        <div className="text-xs text-muted-foreground">
          {status === 'submitted'
            ? '质检与数据交付：可导出当前任务的时间段 JSON，或对不合格标注打回重标。'
            : status === 'claimed'
              ? '异常流转处理：若标注员长期未提交，可强制回收任务回待领取池。'
              : '该任务尚待租户内标注员领取，也可在上方直接指派给指定标注员。'}
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
              onClick={() => setReopenOpen((open) => !open)}
            >
              <Undo2 data-icon="inline-start" />
              {reopenOpen ? '收起' : '打回重标'}
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

      {reopenOpen && status === 'submitted' ? (
        <div className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3.5 py-3">
          <div className="text-xs text-muted-foreground">
            打回原因（必填，标注员会在任务页顶部看到）。写清具体位置和问题，例如「12.5s–18s
            这段是机械臂复位，不应算有效片段」。打回后片段保留为草稿，工时从统计中移除。
          </div>
          <textarea
            rows={3}
            value={reopenNote}
            onChange={(event) => setReopenNote(event.target.value)}
            maxLength={1000}
            placeholder="哪几段有问题、应该怎么改……"
            className="w-full rounded-lg border border-input bg-background p-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">
              {reopenNote.length}/1000
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setReopenOpen(false)}
              >
                取消
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={isPending || !reopenNote.trim()}
                onClick={handleReopen}
              >
                {isPending ? '处理中…' : '确认打回'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

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
