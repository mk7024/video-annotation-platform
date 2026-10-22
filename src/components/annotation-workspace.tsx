'use client'

import { useRef, useState, useTransition } from 'react'
import type { MouseEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Play, Save, Send, Trash2, X } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { formatDuration, formatTimecodeMs } from '@/lib/format'
import type { SegmentInput } from '@/lib/types'
import { saveDraftAction, submitTaskAction } from '@/app/tasks/[id]/actions'

type SegmentItem = SegmentInput & { id: string }

type AnnotationWorkspaceProps = {
  taskId: string
  videoUrl: string
  initialSegments: SegmentInput[]
  readOnly: boolean
}

function signature(segments: SegmentInput[]): string {
  return JSON.stringify(
    segments.map(({ startMs, endMs, note }) => ({
      startMs,
      endMs,
      note: note ?? '',
    }))
  )
}

function totalLength(segments: SegmentInput[]): number {
  return segments.reduce(
    (sum, segment) => sum + (segment.endMs - segment.startMs),
    0
  )
}

export function AnnotationWorkspace({
  taskId,
  videoUrl,
  initialSegments,
  readOnly,
}: AnnotationWorkspaceProps) {
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement>(null)
  const keyRef = useRef(initialSegments.length)

  const [segments, setSegments] = useState<SegmentItem[]>(() =>
    initialSegments.map((segment, index) => ({
      ...segment,
      id: `seg-${index}`,
    }))
  )
  const [savedSignature, setSavedSignature] = useState(() =>
    signature(initialSegments)
  )
  const [pendingStart, setPendingStart] = useState<number | null>(null)
  const [pendingEnd, setPendingEnd] = useState<number | null>(null)
  const [durationMs, setDurationMs] = useState(0)
  const [currentMs, setCurrentMs] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const dirty = signature(segments) !== savedSignature
  const fallbackTotal = segments.reduce(
    (max, segment) => Math.max(max, segment.endMs),
    60_000
  )
  const totalMs = durationMs > 0 ? durationMs : fallbackTotal
  const currentTotalMs = totalLength(segments)

  function toPercent(ms: number): string {
    const ratio = totalMs > 0 ? ms / totalMs : 0
    return `${Math.min(100, Math.max(0, ratio * 100))}%`
  }

  function readCurrentMs(): number {
    return Math.round((videoRef.current?.currentTime ?? 0) * 1000)
  }

  function handleLoadedMetadata() {
    const duration = videoRef.current?.duration
    if (duration && Number.isFinite(duration)) {
      setDurationMs(Math.round(duration * 1000))
    }
  }

  function handleTimeUpdate() {
    setCurrentMs(readCurrentMs())
  }

  function seekTo(ms: number) {
    const video = videoRef.current
    if (!video || video.readyState < 1) {
      return
    }
    video.currentTime = ms / 1000
    setCurrentMs(ms)
  }

  function handleTrackClick(event: MouseEvent<HTMLButtonElement>) {
    const video = videoRef.current
    if (!video || video.readyState < 1) {
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const ratio = Math.min(
      1,
      Math.max(0, (event.clientX - rect.left) / rect.width)
    )
    seekTo(Math.round(ratio * totalMs))
  }

  function addSegment(startMs: number, endMs: number) {
    if (durationMs > 0 && endMs > durationMs + 100) {
      setError('终点超出了视频总时长')
      return
    }

    const overlaps = segments.some(
      (segment) => startMs < segment.endMs && endMs > segment.startMs
    )
    if (overlaps) {
      setError('与已有时间段重叠，请调整起点或终点')
      return
    }

    keyRef.current += 1
    setSegments((previous) =>
      [...previous, { id: `seg-${keyRef.current}`, startMs, endMs }].sort(
        (a, b) => a.startMs - b.startMs
      )
    )
    setPendingStart(null)
    setPendingEnd(null)
    setError(null)
    setNotice('已添加时间段，记得保存草稿')
  }

  function markStart() {
    setPendingStart(readCurrentMs())
    setPendingEnd(null)
    setError(null)
    setNotice(null)
  }

  function markEnd() {
    const endMs = readCurrentMs()
    if (pendingStart == null) {
      setError('请先在片段起点点击“设为起点”')
      return
    }
    setPendingEnd(endMs)
    if (endMs <= pendingStart) {
      setError('终点必须晚于起点')
      return
    }
    addSegment(pendingStart, endMs)
  }

  function clearPending() {
    setPendingStart(null)
    setPendingEnd(null)
    setError(null)
  }

  function removeSegment(id: string) {
    setSegments((previous) => previous.filter((segment) => segment.id !== id))
    setNotice('已删除时间段，记得保存草稿')
  }

  function updateNote(id: string, note: string) {
    setSegments((previous) =>
      previous.map((segment) =>
        segment.id === id ? { ...segment, note } : segment
      )
    )
  }

  function playFrom(ms: number) {
    const video = videoRef.current
    if (!video || video.readyState < 1) {
      return
    }
    video.currentTime = ms / 1000
    void video.play()
  }

  function currentPayload(): SegmentInput[] {
    return segments.map(({ startMs, endMs, note }) => ({
      startMs,
      endMs,
      note,
    }))
  }

  function handleSave() {
    const payload = currentPayload()
    setError(null)
    setNotice(null)

    startTransition(async () => {
      const result = await saveDraftAction(taskId, payload)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSavedSignature(signature(payload))
      setNotice('草稿已保存')
    })
  }

  function handleSubmit() {
    if (segments.length === 0) {
      setError('请至少添加一个时间段后再提交')
      return
    }

    const payload = currentPayload()
    const confirmed = window.confirm(
      `确认提交 ${payload.length} 个时间段（总时长 ${formatDuration(
        totalLength(payload)
      )}）吗？\n提交后不可修改，工时将计入今天。`
    )
    if (!confirmed) {
      return
    }

    setError(null)
    setNotice(null)

    startTransition(async () => {
      const result = await submitTaskAction(taskId, payload)
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.push('/tasks')
      router.refresh()
    })
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
      <Card>
        <CardContent className="flex flex-col gap-4">
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            playsInline
            preload="metadata"
            className="aspect-video w-full rounded-lg bg-black"
            onLoadedMetadata={handleLoadedMetadata}
            onTimeUpdate={handleTimeUpdate}
            onSeeked={handleTimeUpdate}
          />

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>时间段轨道（点击跳转）</span>
              <span className="font-mono tabular-nums">
                {formatTimecodeMs(currentMs)} /{' '}
                {durationMs > 0 ? formatTimecodeMs(durationMs) : '--:--'}
              </span>
            </div>

            <button
              type="button"
              aria-label="视频时间段轨道"
              onClick={handleTrackClick}
              className="relative h-10 w-full cursor-pointer overflow-hidden rounded-lg bg-muted"
            >
              {segments.map((segment) => (
                <span
                  key={segment.id}
                  title={`${formatTimecodeMs(segment.startMs)} – ${formatTimecodeMs(
                    segment.endMs
                  )}${segment.note ? ` · ${segment.note}` : ''}`}
                  className="pointer-events-none absolute inset-y-1.5 rounded-sm bg-primary/70"
                  style={{
                    left: toPercent(segment.startMs),
                    width: toPercent(segment.endMs - segment.startMs),
                    minWidth: '2px',
                  }}
                />
              ))}

              {pendingStart != null && pendingEnd != null && pendingEnd > pendingStart ? (
                <span
                  className="pointer-events-none absolute inset-y-1.5 bg-amber-400/40"
                  style={{
                    left: toPercent(pendingStart),
                    width: toPercent(pendingEnd - pendingStart),
                  }}
                />
              ) : null}

              {pendingStart != null ? (
                <span
                  className="pointer-events-none absolute inset-y-0 border-l-2 border-amber-500"
                  style={{ left: toPercent(pendingStart) }}
                />
              ) : null}

              <span
                className="pointer-events-none absolute inset-y-0 w-px bg-foreground"
                style={{ left: toPercent(currentMs) }}
              />
            </button>

            <div className="flex justify-between font-mono text-[11px] text-muted-foreground">
              <span>00:00.0</span>
              <span>{formatTimecodeMs(totalMs)}</span>
            </div>
          </div>

          {readOnly ? null : (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={markStart}
              >
                设为起点
              </Button>
              <Button type="button" size="sm" onClick={markEnd}>
                设为终点并添加
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearPending}
                disabled={pendingStart == null && pendingEnd == null}
              >
                <X data-icon="inline-start" />
                清除打点
              </Button>
              <span className="text-xs text-muted-foreground">
                起点{' '}
                {pendingStart != null ? formatTimecodeMs(pendingStart) : '—'}
                {' · '}
                终点 {pendingEnd != null ? formatTimecodeMs(pendingEnd) : '—'}
              </span>
            </div>
          )}

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

          {readOnly ? null : (
            <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs text-muted-foreground">
                {dirty ? '有未保存的修改' : '当前内容已保存'}
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSave}
                  disabled={isPending}
                >
                  <Save data-icon="inline-start" />
                  保存草稿
                </Button>
                <Button
                  type="button"
                  onClick={handleSubmit}
                  disabled={isPending || segments.length === 0}
                >
                  <Send data-icon="inline-start" />
                  {isPending ? '处理中…' : '提交任务'}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>时间段</CardTitle>
          <CardDescription>
            {segments.length} 个片段 · 合计 {formatDuration(currentTotalMs)} ·
            可为片段填写备注
          </CardDescription>
        </CardHeader>
        <CardContent>
          {segments.length === 0 ? (
            <div className="rounded-lg border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">
              还没有时间段。
              {readOnly ? '' : '播放视频，在起点和终点分别打点。'}
            </div>
          ) : (
            <ul className="divide-y">
              {segments.map((segment, index) => (
                <li
                  key={segment.id}
                  className="flex flex-col gap-1.5 py-2.5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="w-5 text-xs text-muted-foreground tabular-nums">
                      {index + 1}
                    </span>
                    <span className="font-mono text-sm tabular-nums">
                      {formatTimecodeMs(segment.startMs)} –{' '}
                      {formatTimecodeMs(segment.endMs)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDuration(segment.endMs - segment.startMs)}
                    </span>
                    <span className="ml-auto flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="从该片段开始播放"
                        onClick={() => playFrom(segment.startMs)}
                      >
                        <Play />
                      </Button>
                      {readOnly ? null : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label="删除该时间段"
                          onClick={() => removeSegment(segment.id)}
                        >
                          <Trash2 />
                        </Button>
                      )}
                    </span>
                  </div>

                  {readOnly ? (
                    segment.note ? (
                      <p className="text-xs text-muted-foreground">
                        备注：{segment.note}
                      </p>
                    ) : null
                  ) : (
                    <Input
                      value={segment.note ?? ''}
                      onChange={(event) =>
                        updateNote(segment.id, event.target.value)
                      }
                      maxLength={500}
                      placeholder="备注：这一段在做什么（选填）"
                      className="h-7 text-xs"
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
