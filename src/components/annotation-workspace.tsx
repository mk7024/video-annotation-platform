'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import type { MouseEvent } from 'react'
import { useRouter } from 'next/navigation'
import {
  BookOpen,
  Keyboard,
  Pause,
  Play,
  RotateCcw,
  Save,
  Send,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react'
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
import {
  reportVideoDurationAction,
  saveDraftAction,
  submitTaskAction,
  unclaimTaskAction,
} from '@/app/tasks/[id]/actions'

type SegmentItem = SegmentInput & { id: string }

type AnnotationWorkspaceProps = {
  taskId: string
  videoUrl: string
  videoId?: string
  initialDurationMs?: number | null
  guideline?: string | null
  labels?: string[] | null
  initialSegments: SegmentInput[]
  readOnly: boolean
}

const SPEED_OPTIONS = [0.5, 1, 1.5, 2] as const

// 时间轴缩放档位：null 表示全程。长视频（几十分钟）里片段在全程视图下只有几个像素，
// 缩放到局部窗口后才能看清、点中；缩略导航条负责全程定位
const ZOOM_OPTIONS: Array<{ label: string; ms: number | null }> = [
  { label: '全程', ms: null },
  { label: '5 分钟', ms: 300_000 },
  { label: '1 分钟', ms: 60_000 },
  { label: '15 秒', ms: 15_000 },
]

// 按窗口长度挑一个"整"的刻度步长（约 6~10 根刻度）
function niceRulerStep(rangeMs: number): number {
  const rough = rangeMs / 8
  const steps = [
    100, 200, 500, 1_000, 2_000, 5_000, 10_000, 15_000, 30_000, 60_000,
    120_000, 300_000, 600_000, 900_000, 1_800_000,
  ]
  return steps.find((step) => step >= rough) ?? 3_600_000
}

function formatRulerLabel(ms: number, stepMs: number): string {
  const totalSeconds = ms / 1000
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const secondsText =
    stepMs < 1000
      ? seconds.toFixed(1).padStart(4, '0')
      : String(Math.round(seconds)).padStart(2, '0')
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${secondsText}`
  }
  return `${String(minutes).padStart(2, '0')}:${secondsText}`
}

// 任务未配置标签集时的兜底（通用机器人操作原语）
const DEFAULT_ACTION_TAGS = [
  '抓取物体',
  '移动机械臂',
  '对准目标',
  '推动方块',
  '放置物体',
  '按压按钮',
  '机械臂复位',
] as const

const AUTOSAVE_DELAY_MS = 3000

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
  videoId,
  initialDurationMs,
  guideline,
  labels,
  initialSegments,
  readOnly,
}: AnnotationWorkspaceProps) {
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement>(null)
  const keyRef = useRef(initialSegments.length)
  const autosaveInFlightRef = useRef(false)

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
  const [durationMs, setDurationMs] = useState(
    initialDurationMs && initialDurationMs > 0 ? initialDurationMs : 0
  )
  const [currentMs, setCurrentMs] = useState(0)
  const [playbackRate, setPlaybackRate] = useState<number>(1)
  const [previewEndMs, setPreviewEndMs] = useState<number | null>(null)
  const [zoomWindowMs, setZoomWindowMs] = useState<number | null>(null)
  const [viewStartMs, setViewStartMs] = useState(0)
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null)
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null)
  const [videoLoadError, setVideoLoadError] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [autosaveState, setAutosaveState] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle')
  const [isPending, startTransition] = useTransition()

  const presetTags = useMemo(
    () => (labels && labels.length > 0 ? labels : [...DEFAULT_ACTION_TAGS]),
    [labels]
  )

  const currentSignature = signature(segments)
  const dirty = currentSignature !== savedSignature
  const fallbackTotal = segments.reduce(
    (max, segment) => Math.max(max, segment.endMs),
    60_000
  )
  const totalMs = durationMs > 0 ? durationMs : fallbackTotal
  const currentTotalMs = totalLength(segments)

  // 缩放窗口：以播放头为中心；播放头快移出可视带（前后 10%）时才重新居中，
  // 避免 0.1s 步进时刻度尺跟着抖动。窗口状态在移动播放头的地方同步更新
  const viewMs = Math.min(zoomWindowMs ?? totalMs, totalMs)

  const syncViewWindow = useCallback(
    (ms: number) => {
      setViewStartMs((previous) => {
        const maxStart = Math.max(0, totalMs - viewMs)
        const clamped = Math.min(previous, maxStart)
        const margin = viewMs * 0.1
        if (ms < clamped + margin || ms > clamped + viewMs - margin) {
          return Math.max(0, Math.min(maxStart, ms - viewMs / 2))
        }
        return clamped
      })
    },
    [totalMs, viewMs]
  )

  function changeZoom(nextMs: number | null) {
    setZoomWindowMs(nextMs)
    const nextViewMs = Math.min(nextMs ?? totalMs, totalMs)
    setViewStartMs(
      Math.max(
        0,
        Math.min(Math.max(0, totalMs - nextViewMs), currentMs - nextViewMs / 2)
      )
    )
  }

  // 未保存离开拦截，避免标注员误关标签页丢失草稿
  useEffect(() => {
    if (readOnly || !dirty) {
      return
    }
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [dirty, readOnly])

  function toPercent(ms: number): string {
    const ratio = totalMs > 0 ? ms / totalMs : 0
    return `${Math.min(100, Math.max(0, ratio * 100))}%`
  }

  // 渲染兜底：视频时长晚加载/总长变化时窗口起点可能越界，压回合法区间
  const safeViewStartMs = Math.min(
    viewStartMs,
    Math.max(0, totalMs - viewMs)
  )
  const viewEndMs = safeViewStartMs + viewMs

  function toViewPercent(ms: number): string {
    const ratio = viewMs > 0 ? (ms - safeViewStartMs) / viewMs : 0
    return `${Math.min(100, Math.max(0, ratio * 100))}%`
  }

  const rulerStepMs = niceRulerStep(viewMs)
  const rulerTicks: number[] = []
  for (
    let tick = Math.ceil(safeViewStartMs / rulerStepMs) * rulerStepMs;
    tick <= viewEndMs;
    tick += rulerStepMs
  ) {
    rulerTicks.push(tick)
  }

  const readCurrentMs = useCallback((): number => {
    return Math.round((videoRef.current?.currentTime ?? 0) * 1000)
  }, [])

  function handleLoadedMetadata() {
    setVideoLoadError(false)
    const duration = videoRef.current?.duration
    if (duration && Number.isFinite(duration)) {
      const loadedMs = Math.round(duration * 1000)
      setDurationMs(loadedMs)

      // 首次打开时把视频实际时长回填视频库，之后服务端校验不再依赖客户端传值
      if (videoId && !initialDurationMs) {
        void reportVideoDurationAction(videoId, loadedMs).then((result) => {
          if (!result.ok) {
            // 回填失败不影响标注，仅静默降级
            console.warn('视频时长回填失败', result.error)
          }
        })
      }
    }
  }

  function handleTimeUpdate() {
    const ms = readCurrentMs()
    // 区间预览模式：播放到达当前预览片段终点时自动暂停
    let finalMs = ms
    if (previewEndMs != null && ms >= previewEndMs) {
      const video = videoRef.current
      if (video && !video.paused) {
        video.pause()
        video.currentTime = previewEndMs / 1000
      }
      finalMs = previewEndMs
      setPreviewEndMs(null)
    }
    setCurrentMs(finalMs)
    syncViewWindow(finalMs)
  }

  const seekTo = useCallback(
    (ms: number) => {
      const video = videoRef.current
      if (!video || video.readyState < 1) {
        return
      }
      const maxMs = durationMs > 0 ? durationMs : totalMs
      const clamped = Math.max(0, Math.min(maxMs, Math.round(ms)))
      setPreviewEndMs(null)
      video.currentTime = clamped / 1000
      setCurrentMs(clamped)
      syncViewWindow(clamped)
    },
    [durationMs, totalMs, syncViewWindow]
  )

  const stepByMs = useCallback(
    (deltaMs: number) => {
      const video = videoRef.current
      if (!video || video.readyState < 1) {
        return
      }
      if (!video.paused) {
        video.pause()
      }
      seekTo(readCurrentMs() + deltaMs)
    },
    [readCurrentMs, seekTo]
  )

  function changeSpeed(rate: number) {
    setPlaybackRate(rate)
    if (videoRef.current) {
      videoRef.current.playbackRate = rate
    }
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
    seekTo(Math.round(viewStartMs + ratio * viewMs))
  }

  // 缩略导航条：始终展示全程，点击直接把播放头跳到对应位置
  function handleOverviewClick(event: MouseEvent<HTMLButtonElement>) {
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

  const addSegment = useCallback(
    (startMs: number, endMs: number) => {
      if (endMs - startMs < 100) {
        setError('片段长度至少需要 0.1 秒')
        return
      }
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
      const newId = `seg-${keyRef.current}`
      setSegments((previous) =>
        [...previous, { id: newId, startMs, endMs }].sort(
          (a, b) => a.startMs - b.startMs
        )
      )
      setActiveSegmentId(newId)
      setPendingStart(null)
      setPendingEnd(null)
      setError(null)
      setNotice('已添加时间段，记得保存草稿')
    },
    [durationMs, segments]
  )

  const markStart = useCallback(() => {
    setPendingStart(readCurrentMs())
    setPendingEnd(null)
    setError(null)
    setNotice(null)
  }, [readCurrentMs])

  const markEnd = useCallback(() => {
    const endMs = readCurrentMs()
    if (pendingStart == null) {
      setError('请先在片段起点点击“设为起点”（或按快捷键 I / [）')
      return
    }
    setPendingEnd(endMs)
    if (endMs <= pendingStart) {
      setError('终点必须晚于起点')
      return
    }
    addSegment(pendingStart, endMs)
  }, [addSegment, pendingStart, readCurrentMs])

  const clearPending = useCallback(() => {
    setPendingStart(null)
    setPendingEnd(null)
    setError(null)
  }, [])

  // 键盘快捷键支持：Space 播放/暂停，I/[ 设起点，O/] 设终点，←/→ 逐帧步进
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      if (event.code === 'Space') {
        const video = videoRef.current
        if (video && target !== video) {
          event.preventDefault()
          if (video.paused) {
            void video.play()
          } else {
            video.pause()
          }
        }
        return
      }

      if (event.code === 'ArrowLeft') {
        event.preventDefault()
        stepByMs(event.shiftKey ? -1000 : -100)
        return
      }

      if (event.code === 'ArrowRight') {
        event.preventDefault()
        stepByMs(event.shiftKey ? 1000 : 100)
        return
      }

      if (readOnly) {
        return
      }

      if (event.code === 'KeyI' || event.code === 'BracketLeft') {
        event.preventDefault()
        markStart()
      } else if (event.code === 'KeyO' || event.code === 'BracketRight') {
        event.preventDefault()
        markEnd()
      } else if (event.code === 'Escape') {
        clearPending()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [clearPending, markEnd, markStart, readOnly, stepByMs])

  // 草稿自动保存：修改停止数秒后触发；保存期间或提交中不调度，成功后若仍在编辑会自动进入下一轮
  useEffect(() => {
    if (readOnly || !dirty || isPending || autosaveInFlightRef.current) {
      return
    }

    const timer = setTimeout(() => {
      if (autosaveInFlightRef.current) {
        return
      }
      autosaveInFlightRef.current = true
      setAutosaveState('saving')

      const payload = currentPayload()
      void saveDraftAction(
        taskId,
        payload,
        durationMs > 0 ? durationMs : undefined
      )
        .then((result) => {
          if (!result.ok) {
            setAutosaveState('error')
            return
          }
          setSavedSignature(signature(payload))
          setAutosaveState('saved')
        })
        .finally(() => {
          autosaveInFlightRef.current = false
        })
    }, AUTOSAVE_DELAY_MS)

    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSignature, savedSignature, readOnly, isPending, segments, taskId, durationMs])

  function removeSegment(id: string) {
    setSegments((previous) => previous.filter((segment) => segment.id !== id))
    if (activeSegmentId === id) {
      setActiveSegmentId(null)
      setPreviewEndMs(null)
    }
    if (editingSegmentId === id) {
      setEditingSegmentId(null)
    }
    setNotice('已删除时间段，记得保存草稿')
  }

  function updateSegmentBounds(
    id: string,
    nextStartMs: number,
    nextEndMs: number
  ) {
    const start = Math.round(nextStartMs)
    const end = Math.round(nextEndMs)

    if (start < 0) {
      setError('起点不能小于 00:00.0')
      return
    }
    if (end - start < 100) {
      setError('片段长度至少需要 0.1 秒')
      return
    }
    if (durationMs > 0 && end > durationMs + 100) {
      setError('终点不能超出视频总时长')
      return
    }

    const overlaps = segments.some(
      (segment) =>
        segment.id !== id && start < segment.endMs && end > segment.startMs
    )
    if (overlaps) {
      setError('微调后的时间段与其他片段重叠')
      return
    }

    setSegments((previous) =>
      previous
        .map((segment) =>
          segment.id === id
            ? { ...segment, startMs: start, endMs: end }
            : segment
        )
        .sort((a, b) => a.startMs - b.startMs)
    )
    setError(null)
    setNotice('已微调时间段边界，记得保存草稿')
  }

  function updateNote(id: string, note: string) {
    setSegments((previous) =>
      previous.map((segment) =>
        segment.id === id ? { ...segment, note } : segment
      )
    )
  }

  function applyPresetTag(id: string, tag: string) {
    const target = segments.find((s) => s.id === id)
    if (!target) {
      return
    }
    const existing = (target.note ?? '').trim()
    if (!existing) {
      updateNote(id, `[${tag}] `)
      return
    }
    if (existing.startsWith(`[${tag}]`)) {
      return
    }
    const stripped = existing.replace(/^\[[^\]]+\]\s*/, '')
    updateNote(id, `[${tag}] ${stripped}`)
  }

  function previewSegment(segment: SegmentItem) {
    const video = videoRef.current
    setActiveSegmentId(segment.id)
    if (!video || video.readyState < 1) {
      return
    }
    setPreviewEndMs(segment.endMs)
    video.currentTime = segment.startMs / 1000
    setCurrentMs(segment.startMs)
    syncViewWindow(segment.startMs)
    void video.play()
  }

  function stopPreview() {
    setPreviewEndMs(null)
    videoRef.current?.pause()
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
      const result = await saveDraftAction(
        taskId,
        payload,
        durationMs > 0 ? durationMs : undefined
      )
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
      const result = await submitTaskAction(
        taskId,
        payload,
        durationMs > 0 ? durationMs : undefined
      )
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.push('/tasks')
      router.refresh()
    })
  }

  function handleUnclaim() {
    const confirmed = window.confirm(
      '确认放弃并释放该任务吗？\n当前未提交的草稿片段将被清空，任务将退回本租户的待领取池。'
    )
    if (!confirmed) {
      return
    }

    setError(null)
    setNotice(null)

    startTransition(async () => {
      const result = await unclaimTaskAction(taskId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.push('/tasks')
      router.refresh()
    })
  }

  return (
    <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(360px,1fr)]">
      <Card className="min-w-0">
        <CardContent className="flex min-w-0 flex-col gap-5">
          {guideline ? (
            <div className="flex items-start gap-3 rounded-lg border border-amber-200/70 bg-amber-50/50 p-3 text-sm dark:border-amber-500/20 dark:bg-amber-500/5">
              <BookOpen className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" />
              <div className="min-w-0">
                <p className="font-medium text-amber-900 dark:text-amber-300">
                  标注指引
                </p>
                <p className="mt-2 max-h-24 overflow-y-auto whitespace-pre-wrap text-amber-950/80 [overflow-wrap:anywhere] dark:text-amber-100/80">
                  {guideline}
                </p>
              </div>
            </div>
          ) : null}

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
            onError={() => setVideoLoadError(true)}
          />

          {videoLoadError ? (
            <Alert variant="destructive">
              <AlertDescription>
                视频加载遇到网络问题（Hugging Face 远程大视频可能需要科学上网或稍作等待），您也可以点击右上角「原始视频」测试连接。
              </AlertDescription>
            </Alert>
          ) : null}

          <section
            aria-label="视频时间轴与播放控制"
            className="@container/timeline min-w-0 rounded-xl border bg-muted/40"
          >
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3 p-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h2 className="text-sm font-semibold">时间轴</h2>
                <span className="whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground">
                  <span className="font-semibold text-foreground">
                    {formatTimecodeMs(currentMs)}
                  </span>{' '}
                  / {durationMs > 0 ? formatTimecodeMs(durationMs) : '--:--'}
                </span>
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-1 rounded-lg border bg-background p-1">
                {ZOOM_OPTIONS.map((option) => (
                  <Button
                    key={option.label}
                    type="button"
                    variant={
                      zoomWindowMs === option.ms ? 'secondary' : 'ghost'
                    }
                    size="xs"
                    className="h-8 px-2.5"
                    aria-pressed={zoomWindowMs === option.ms}
                    onClick={() => changeZoom(option.ms)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex min-w-0 flex-col gap-2 px-3 pb-3">
              <div className="relative h-6 w-full overflow-hidden select-none">
                {rulerTicks.map((tick, index) => (
                  <span
                    key={tick}
                    className={`absolute bottom-0 flex flex-col ${
                      index === 0
                        ? 'items-start'
                        : index === rulerTicks.length - 1
                          ? '-translate-x-full items-end'
                          : '-translate-x-1/2 items-center'
                    }`}
                    style={{ left: toViewPercent(tick) }}
                  >
                    <span className="font-mono text-[11px] leading-none tabular-nums text-muted-foreground">
                      {formatRulerLabel(tick, rulerStepMs)}
                    </span>
                    <span className="mt-1 h-1 w-px bg-border" />
                  </span>
                ))}
              </div>

              <button
                type="button"
                aria-label="视频时间段轨道"
                onClick={handleTrackClick}
                className="relative h-14 w-full cursor-pointer overflow-hidden rounded-lg border bg-background outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {segments.map((segment, index) => {
                  const visibleStartMs = Math.max(segment.startMs, safeViewStartMs)
                  const visibleEndMs = Math.min(segment.endMs, viewEndMs)
                  if (visibleEndMs <= visibleStartMs) {
                    return null
                  }
                  const isActive = activeSegmentId === segment.id
                  return (
                    <span
                      key={segment.id}
                      onClick={(event) => {
                        event.stopPropagation()
                        previewSegment(segment)
                      }}
                      title={`#${index + 1} ${formatTimecodeMs(
                        segment.startMs
                      )} – ${formatTimecodeMs(segment.endMs)}${
                        segment.note ? ` · ${segment.note}` : ''
                      }（点击预览此区间）`}
                      className={`absolute inset-y-2 flex items-center justify-center overflow-hidden rounded text-xs font-medium tabular-nums transition-colors ${
                        isActive
                          ? 'bg-emerald-700 text-white ring-2 ring-emerald-400 dark:ring-emerald-300'
                          : 'bg-primary/75 text-primary-foreground hover:bg-primary'
                      }`}
                      style={{
                        left: toViewPercent(visibleStartMs),
                        width: `${
                          ((visibleEndMs - visibleStartMs) / Math.max(1, viewMs)) *
                          100
                        }%`,
                        minWidth: '6px',
                      }}
                    >
                      <span className="truncate px-1">{index + 1}</span>
                    </span>
                  )
                })}

                {pendingStart != null &&
                pendingEnd != null &&
                pendingEnd > pendingStart ? (
                  <span
                    className="pointer-events-none absolute inset-y-2 bg-amber-400/40 dark:bg-amber-400/30"
                    style={{
                      left: toViewPercent(pendingStart),
                      width: `${
                        ((pendingEnd - pendingStart) / Math.max(1, viewMs)) * 100
                      }%`,
                    }}
                  />
                ) : null}

                {pendingStart != null ? (
                  <span
                    className="pointer-events-none absolute inset-y-0 border-l-2 border-amber-600 dark:border-amber-400"
                    style={{ left: toViewPercent(pendingStart) }}
                  />
                ) : null}

                <span
                  className="pointer-events-none absolute inset-y-0 w-0.5 bg-foreground ring-1 ring-background/70"
                  style={{ left: toViewPercent(currentMs) }}
                />
              </button>

              {zoomWindowMs != null && viewMs < totalMs ? (
                <button
                  type="button"
                  aria-label="全程缩略导航"
                  onClick={handleOverviewClick}
                  className="relative h-6 w-full cursor-pointer overflow-hidden rounded-md border bg-background outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  title="全程缩略图：蓝框为当前窗口位置，点击任意位置跳转"
                >
                  {segments.map((segment, index) => (
                    <span
                      key={segment.id}
                      className="absolute inset-y-1 rounded-sm bg-primary/60"
                      style={{
                        left: toPercent(segment.startMs),
                        width: toPercent(segment.endMs - segment.startMs),
                        minWidth: '2px',
                      }}
                      title={`#${index + 1}`}
                    />
                  ))}
                  <span
                    className="pointer-events-none absolute inset-y-0 border-x-2 border-sky-600 bg-sky-500/15 dark:border-sky-400 dark:bg-sky-400/20"
                    style={{
                      left: toPercent(safeViewStartMs),
                      width: `${(viewMs / Math.max(1, totalMs)) * 100}%`,
                    }}
                  />
                  <span
                    className="pointer-events-none absolute inset-y-0 w-0.5 bg-foreground ring-1 ring-background/70"
                    style={{ left: toPercent(currentMs) }}
                  />
                </button>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[11px] leading-relaxed text-muted-foreground">
                <span className="whitespace-nowrap">
                  窗口{' '}
                  <span className="font-mono tabular-nums">
                    {formatRulerLabel(viewStartMs, rulerStepMs)} –{' '}
                    {formatRulerLabel(viewEndMs, rulerStepMs)}
                  </span>
                </span>
                {previewEndMs != null ? (
                  <span className="text-emerald-700 dark:text-emerald-400">
                    正在区间预览（将在{' '}
                    <span className="font-mono tabular-nums">
                      {formatTimecodeMs(previewEndMs)}
                    </span>{' '}
                    自动暂停）
                  </span>
                ) : null}
                <span>点击空白处跳转 · 点击色块预览</span>
              </div>
            </div>

            <div className="grid gap-3 border-t p-3 @min-[38rem]/timeline:grid-cols-[minmax(0,1fr)_auto] @min-[38rem]/timeline:gap-5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="w-12 shrink-0 text-xs text-muted-foreground">
                  微调步进
                </span>
                <div className="grid min-w-0 flex-1 grid-cols-4 gap-1 rounded-lg border bg-background p-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="h-8 min-w-0 px-1 font-mono tabular-nums"
                    onClick={() => stepByMs(-1000)}
                    title="后退 1 秒 (Shift + ←)"
                  >
                    -1.0s
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="h-8 min-w-0 px-1 font-mono tabular-nums"
                    onClick={() => stepByMs(-100)}
                    title="后退 0.1 秒 (←)"
                  >
                    -0.1s
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="h-8 min-w-0 px-1 font-mono tabular-nums"
                    onClick={() => stepByMs(100)}
                    title="前进 0.1 秒 (→)"
                  >
                    +0.1s
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="h-8 min-w-0 px-1 font-mono tabular-nums"
                    onClick={() => stepByMs(1000)}
                    title="前进 1 秒 (Shift + →)"
                  >
                    +1.0s
                  </Button>
                </div>
              </div>

              <div className="flex min-w-0 items-center gap-3">
                <span className="w-12 shrink-0 text-xs text-muted-foreground @min-[38rem]/timeline:w-auto">
                  倍速
                </span>
                <div className="grid min-w-0 flex-1 grid-cols-4 gap-1 rounded-lg border bg-background p-1">
                  {SPEED_OPTIONS.map((rate) => (
                    <Button
                      key={rate}
                      type="button"
                      variant={playbackRate === rate ? 'secondary' : 'ghost'}
                      size="xs"
                      className="h-8 min-w-0 px-2 font-mono tabular-nums"
                      aria-pressed={playbackRate === rate}
                      onClick={() => changeSpeed(rate)}
                    >
                      {rate}x
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {readOnly ? null : (
            <div className="flex flex-col gap-2">
              <div className="@container/mark rounded-xl border border-amber-200/80 bg-amber-50/40 p-3 dark:border-amber-500/25 dark:bg-amber-500/5">
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-auto min-h-11 flex-wrap gap-x-3 gap-y-1 border-amber-300 bg-background px-3 py-2 text-sm whitespace-normal text-amber-900 hover:bg-amber-100 hover:text-amber-950 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-200 dark:hover:bg-amber-500/20 dark:hover:text-amber-100"
                    onClick={markStart}
                  >
                    设为起点
                    <kbd className="whitespace-nowrap rounded border border-current/20 px-1.5 py-0.5 font-mono text-[11px]">
                      I / [
                    </kbd>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className="h-auto min-h-11 flex-wrap gap-x-3 gap-y-1 bg-amber-400 px-3 py-2 text-sm whitespace-normal text-amber-950 shadow-sm hover:bg-amber-300 dark:bg-amber-400 dark:text-amber-950 dark:hover:bg-amber-300"
                    onClick={markEnd}
                  >
                    设为终点并添加
                    <kbd className="whitespace-nowrap rounded border border-current/20 px-1.5 py-0.5 font-mono text-[11px]">
                      O / ]
                    </kbd>
                  </Button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                    <span>
                      起点{' '}
                      <span className="font-mono font-medium tabular-nums text-amber-900 dark:text-amber-200">
                        {pendingStart != null ? formatTimecodeMs(pendingStart) : '—'}
                      </span>
                    </span>
                    <span>
                      终点{' '}
                      <span className="font-mono font-medium tabular-nums text-amber-900 dark:text-amber-200">
                        {pendingEnd != null ? formatTimecodeMs(pendingEnd) : '—'}
                      </span>
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-auto h-9 text-xs text-muted-foreground"
                    onClick={clearPending}
                    disabled={pendingStart == null && pendingEnd == null}
                  >
                    <X data-icon="inline-start" />
                    清除打点
                  </Button>
                </div>
              </div>

              <details className="rounded-lg text-xs text-muted-foreground">
                <summary className="w-fit cursor-pointer rounded-md px-1 py-2 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="ml-1 inline-flex items-center gap-2 align-middle">
                    <Keyboard className="size-3.5" />
                    操作说明与快捷键
                  </span>
                </summary>
                <div className="mt-2 space-y-3 rounded-lg border bg-muted/30 p-3 leading-relaxed">
                  <p>
                    点击色块预览该片段并在终点自动暂停；长视频建议切到
                    1 分钟 / 15 秒档位精修边界。
                  </p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                    <span>
                      <kbd className="rounded border bg-background px-1.5 py-0.5 font-mono">
                        Space
                      </kbd>{' '}
                      播放/暂停
                    </span>
                    <span>
                      <kbd className="rounded border bg-background px-1.5 py-0.5 font-mono">
                        I / [
                      </kbd>{' '}
                      设为起点
                    </span>
                    <span>
                      <kbd className="rounded border bg-background px-1.5 py-0.5 font-mono">
                        O / ]
                      </kbd>{' '}
                      设为终点
                    </span>
                    <span>
                      <kbd className="rounded border bg-background px-1.5 py-0.5 font-mono">
                        ← / →
                      </kbd>{' '}
                      步进 0.1s（配合 Shift 步进 1s）
                    </span>
                    <span>
                      <kbd className="rounded border bg-background px-1.5 py-0.5 font-mono">
                        Esc
                      </kbd>{' '}
                      清除打点
                    </span>
                  </div>
                </div>
              </details>
            </div>
          )}

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {notice ? (
            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300">
              {notice}
            </p>
          ) : null}

          {readOnly ? null : (
            <div className="@container/actions flex flex-col gap-3 border-t pt-4">
              <p className="text-xs leading-relaxed text-muted-foreground">
                {autosaveState === 'saving'
                  ? '● 自动保存中…'
                  : autosaveState === 'error' && dirty
                    ? '⚠ 自动保存失败，请手动保存'
                    : dirty
                      ? '● 修改将在片刻后自动保存'
                      : '✓ 当前内容已保存'}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleUnclaim}
                  disabled={isPending}
                  className="h-11 text-muted-foreground hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/10"
                >
                  <RotateCcw data-icon="inline-start" />
                  释放回任务池
                </Button>
                <div className="ml-auto grid basis-full grid-cols-2 gap-3 @min-[30rem]/actions:basis-auto">
                  <Button
                    type="button"
                    variant="outline"
                    className="h-11 px-4"
                    onClick={handleSave}
                    disabled={isPending}
                  >
                    <Save data-icon="inline-start" />
                    保存草稿
                  </Button>
                  <Button
                    type="button"
                    className="h-11 px-5 font-semibold shadow-sm"
                    onClick={handleSubmit}
                    disabled={isPending || segments.length === 0}
                  >
                    <Send data-icon="inline-start" />
                    {isPending ? '处理中…' : '提交任务'}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="min-w-0 gap-0 py-0">
        <CardHeader className="gap-3 border-b bg-muted/30 p-4">
          <CardTitle className="flex flex-wrap items-center justify-between gap-2 font-semibold">
            时间段列表
            <span className="rounded-md border bg-background px-2 py-1 text-xs font-normal text-muted-foreground">
              <span className="font-mono font-semibold tabular-nums text-foreground">
                {segments.length}
              </span>{' '}
              个片段
            </span>
          </CardTitle>
          <CardDescription className="space-y-2 text-xs leading-relaxed">
            <p>
              有效时长合计{' '}
              <span className="font-mono font-medium tabular-nums text-foreground">
                {formatDuration(currentTotalMs)}
              </span>
            </p>
            <p>{readOnly ? '点击播放可区间预览' : '支持边界微调与动作标签'}</p>
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4">
          {segments.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-muted/20 px-5 py-10 text-center text-sm leading-7 text-muted-foreground">
              <p className="font-medium text-foreground">还没有时间段。</p>
              {readOnly
                ? ''
                : '播放视频，用按钮或快捷键 I / O 在起点和终点分别打点。'}
            </div>
          ) : (
            <ul className="flex min-w-0 flex-col gap-3">
              {segments.map((segment, index) => {
                const isPreviewing =
                  activeSegmentId === segment.id && previewEndMs != null
                const isEditing = editingSegmentId === segment.id

                return (
                  <li
                    key={segment.id}
                    className={`flex min-w-0 flex-col gap-3 rounded-xl border p-3 transition-colors ${
                      activeSegmentId === segment.id
                        ? 'border-emerald-300 bg-emerald-50/60 dark:border-emerald-500/50 dark:bg-emerald-500/10'
                        : 'border-border bg-background'
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-xs font-medium tabular-nums text-muted-foreground">
                        #{index + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => previewSegment(segment)}
                        className="flex min-h-11 min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md py-2 text-left font-mono text-sm font-medium tabular-nums underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                        title="点击预览该片段（播到终点自动暂停）"
                      >
                        <span className="whitespace-nowrap">{formatTimecodeMs(segment.startMs)}</span>
                        <span className="text-muted-foreground">–</span>
                        <span className="whitespace-nowrap">{formatTimecodeMs(segment.endMs)}</span>
                      </button>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">
                        时长{' '}
                        <span className="font-mono tabular-nums">
                          {formatDuration(segment.endMs - segment.startMs)}
                        </span>
                      </span>
                      <span className="ml-auto flex items-center gap-2">
                        <Button
                          type="button"
                          variant={isPreviewing ? 'default' : 'ghost'}
                          size="icon-sm"
                          className={`size-11 ${
                            isPreviewing
                              ? 'bg-emerald-700 text-white hover:bg-emerald-800 dark:bg-emerald-700 dark:hover:bg-emerald-600'
                              : 'text-muted-foreground'
                          }`}
                          aria-label={
                            isPreviewing ? '停止预览' : '区间预览该片段'
                          }
                          title={
                            isPreviewing
                              ? '停止预览'
                              : '预览该片段（到终点自动暂停）'
                          }
                          onClick={() =>
                            isPreviewing
                              ? stopPreview()
                              : previewSegment(segment)
                          }
                        >
                          {isPreviewing ? <Pause /> : <Play />}
                        </Button>
                        {readOnly ? null : (
                          <>
                            <Button
                              type="button"
                              variant={isEditing ? 'secondary' : 'ghost'}
                              size="icon-sm"
                              className="size-11 text-muted-foreground aria-expanded:text-foreground"
                              aria-label="微调起止时间"
                              aria-expanded={isEditing}
                              title="微调起止时间与动作标签"
                              onClick={() =>
                                setEditingSegmentId(
                                  isEditing ? null : segment.id
                                )
                              }
                            >
                              <SlidersHorizontal />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="size-11 text-muted-foreground hover:bg-destructive/10 hover:text-destructive dark:hover:bg-destructive/10"
                              aria-label="删除该时间段"
                              title="删除该时间段"
                              onClick={() => removeSegment(segment.id)}
                            >
                              <Trash2 />
                            </Button>
                          </>
                        )}
                      </span>
                    </div>

                    {readOnly ? null : isEditing ? (
                      <div className="flex min-w-0 flex-col gap-4 rounded-lg border bg-muted/30 p-3 text-xs">
                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-muted-foreground">起点</span>
                            <span className="font-mono tabular-nums">
                              {formatTimecodeMs(segment.startMs)}
                            </span>
                          </div>
                          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.7fr)] gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              className="h-11 min-w-0 px-1 font-mono tabular-nums"
                              onClick={() =>
                                updateSegmentBounds(
                                  segment.id,
                                  segment.startMs - 100,
                                  segment.endMs
                                )
                              }
                            >
                              -0.1s
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              className="h-11 min-w-0 px-1 font-mono tabular-nums"
                              onClick={() =>
                                updateSegmentBounds(
                                  segment.id,
                                  segment.startMs + 100,
                                  segment.endMs
                                )
                              }
                            >
                              +0.1s
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              className="h-auto min-h-11 min-w-0 px-2 py-1 whitespace-normal"
                              onClick={() =>
                                updateSegmentBounds(
                                  segment.id,
                                  readCurrentMs(),
                                  segment.endMs
                                )
                              }
                            >
                              设为当前时间
                            </Button>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-muted-foreground">终点</span>
                            <span className="font-mono tabular-nums">
                              {formatTimecodeMs(segment.endMs)}
                            </span>
                          </div>
                          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.7fr)] gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              className="h-11 min-w-0 px-1 font-mono tabular-nums"
                              onClick={() =>
                                updateSegmentBounds(
                                  segment.id,
                                  segment.startMs,
                                  segment.endMs - 100
                                )
                              }
                            >
                              -0.1s
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              className="h-11 min-w-0 px-1 font-mono tabular-nums"
                              onClick={() =>
                                updateSegmentBounds(
                                  segment.id,
                                  segment.startMs,
                                  segment.endMs + 100
                                )
                              }
                            >
                              +0.1s
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="xs"
                              className="h-auto min-h-11 min-w-0 px-2 py-1 whitespace-normal"
                              onClick={() =>
                                updateSegmentBounds(
                                  segment.id,
                                  segment.startMs,
                                  readCurrentMs()
                                )
                              }
                            >
                              设为当前时间
                            </Button>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                          <span className="w-full text-muted-foreground">
                            快捷标签
                          </span>
                          {presetTags.map((tag) => (
                            <button
                              key={tag}
                              type="button"
                              onClick={() => applyPresetTag(segment.id, tag)}
                              className="min-h-11 max-w-full rounded-lg border bg-background px-2.5 py-2 text-left text-xs text-foreground transition-colors outline-none [overflow-wrap:anywhere] hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              +{tag}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {readOnly ? (
                      segment.note ? (
                        <p className="text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
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
                        aria-label={`片段 ${index + 1} 的动作标签或备注`}
                        placeholder="动作标签或备注（选填）"
                        title="点击滑块图标可微调时间与选标签"
                        className="h-11 min-w-0 bg-background text-xs"
                      />
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
