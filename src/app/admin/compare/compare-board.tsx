'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { GitCompareArrows } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDuration, formatShanghaiDateTime, formatTimecodeMs } from '@/lib/format'
import { intervalsIntersectionMs, temporalIou, type Interval } from '@/lib/iou'

type Submission = {
  taskId: string
  title: string
  annotator: string
  submittedAt: string | null
  segments: Array<{ start_ms: number; end_ms: number; note: string | null }>
}

type CompareBoardProps = {
  videoTitle: string
  videoDurationMs: number | null
  submissions: Submission[]
}

function toIntervals(segments: Submission['segments']): Interval[] {
  return segments.map((segment) => ({
    start: segment.start_ms,
    end: segment.end_ms,
  }))
}

function intersectionIntervals(a: Interval[], b: Interval[]): Interval[] {
  const result: Interval[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const start = Math.max(a[i].start, b[j].start)
    const end = Math.min(a[i].end, b[j].end)
    if (end > start) {
      result.push({ start, end })
    }
    if (a[i].end < b[j].end) {
      i += 1
    } else {
      j += 1
    }
  }
  return result
}

function TrackRow({
  intervals,
  colorClass,
  label,
  totalMs,
}: {
  intervals: Interval[]
  colorClass: string
  label: string
  totalMs: number
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 truncate text-right text-xs text-muted-foreground">
        {label}
      </span>
      <div className="relative h-7 flex-1 overflow-hidden rounded-md border bg-muted">
        {intervals.map((interval, index) => (
          <span
            key={index}
            className={`absolute inset-y-1 rounded-sm ${colorClass}`}
            style={{
              left: `${(interval.start / totalMs) * 100}%`,
              width: `${Math.max(0.4, ((interval.end - interval.start) / totalMs) * 100)}%`,
            }}
          />
        ))}
      </div>
    </div>
  )
}

export function CompareBoard({
  videoTitle,
  videoDurationMs,
  submissions,
}: CompareBoardProps) {
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  function toggleSelection(taskId: string) {
    setSelectedIds((previous) => {
      if (previous.includes(taskId)) {
        return previous.filter((id) => id !== taskId)
      }
      return [...previous.slice(-1), taskId]
    })
  }

  const selected = submissions.filter((submission) =>
    selectedIds.includes(submission.taskId)
  )

  const comparison = useMemo(() => {
    if (selected.length !== 2) {
      return null
    }
    const [first, second] = selected
    const intervalsA = toIntervals(first.segments)
    const intervalsB = toIntervals(second.segments)
    const result = temporalIou(intervalsA, intervalsB)
    const shared = intersectionIntervals(intervalsA, intervalsB)

    // 片段对级匹配：A 的每个片段与 B 的重叠时长
    const pairRows = first.segments.map((segment, index) => {
      const overlap = intervalsIntersectionMs(
        [{ start: segment.start_ms, end: segment.end_ms }],
        intervalsB
      )
      return {
        index: index + 1,
        range: `${formatTimecodeMs(segment.start_ms)} – ${formatTimecodeMs(segment.end_ms)}`,
        note: segment.note,
        durationMs: segment.end_ms - segment.start_ms,
        overlapMs: overlap,
      }
    })

    return {
      first,
      second,
      intervalsA,
      intervalsB,
      shared,
      stats: result,
      pairRows,
    }
  }, [selected])

  const trackTotalMs = Math.max(
    videoDurationMs ?? 0,
    ...submissions.flatMap((submission) =>
      submission.segments.map((segment) => segment.end_ms)
    ),
    1
  )

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>选择两份提交进行比对</CardTitle>
          <CardDescription>
            同一视频的多份独立标注（可批量发布同一视频生成多任务）。选中两份后自动计算时间
            IoU——两人重叠越多，标注标准越一致。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {submissions.map((submission) => {
              const isSelected = selectedIds.includes(submission.taskId)
              return (
                <button
                  key={submission.taskId}
                  type="button"
                  onClick={() => toggleSelection(submission.taskId)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    isSelected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground'
                  }`}
                >
                  {submission.annotator} ·{' '}
                  {submission.submittedAt
                    ? formatShanghaiDateTime(submission.submittedAt)
                    : '—'}
                  （{submission.segments.length} 段）
                </button>
              )
            })}
          </div>

          {submissions.length < 2 ? (
            <p className="text-sm text-muted-foreground">
              该视频目前只有 {submissions.length} 份已提交标注，需要至少两份才能比对。可以在
              任务管理中对同一视频再次发布任务。
            </p>
          ) : null}
        </CardContent>
      </Card>

      {comparison ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>一致性指标</CardTitle>
              <CardDescription>
                时间 IoU = |两人重叠时长| ÷ |两人标注并集时长|，业界常以 ≥ 0.7
                作为时间片段标注的合格阈值，低于阈值应对照标注指引复核。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
                  <p className="text-xs text-muted-foreground">
                    {comparison.first.annotator} 有效时长
                  </p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">
                    {formatDuration(
                      comparison.intervalsA.reduce(
                        (sum, item) => sum + (item.end - item.start),
                        0
                      )
                    )}
                  </p>
                </div>
                <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
                  <p className="text-xs text-muted-foreground">
                    {comparison.second.annotator} 有效时长
                  </p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">
                    {formatDuration(
                      comparison.intervalsB.reduce(
                        (sum, item) => sum + (item.end - item.start),
                        0
                      )
                    )}
                  </p>
                </div>
                <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
                  <p className="text-xs text-muted-foreground">重叠 / 并集</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">
                    {formatDuration(comparison.stats?.intersectionMs ?? 0)} /{' '}
                    {formatDuration(comparison.stats?.unionMs ?? 0)}
                  </p>
                </div>
                <div
                  className={`rounded-lg border px-3 py-2.5 ${
                    (comparison.stats?.iou ?? 0) >= 0.7
                      ? 'border-emerald-400/50 bg-emerald-50/50 dark:bg-emerald-500/10'
                      : 'border-amber-400/50 bg-amber-50/50 dark:bg-amber-500/10'
                  }`}
                >
                  <p className="text-xs text-muted-foreground">时间 IoU</p>
                  <p className="mt-1 text-lg font-semibold tabular-nums">
                    {comparison.stats
                      ? `${(comparison.stats.iou * 100).toFixed(1)}%`
                      : '—'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>时间轴叠加对比 · {videoTitle}</CardTitle>
              <CardDescription>
                绿色 / 蓝色分别是两位标注员的片段，紫色是双方重叠的部分。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <TrackRow
                intervals={comparison.intervalsA}
                colorClass="bg-emerald-500/80"
                label={comparison.first.annotator}
                totalMs={trackTotalMs}
              />
              <TrackRow
                intervals={comparison.intervalsB}
                colorClass="bg-sky-500/80"
                label={comparison.second.annotator}
                totalMs={trackTotalMs}
              />
              <TrackRow
                intervals={comparison.shared}
                colorClass="bg-violet-500/80"
                label="双方重叠"
                totalMs={trackTotalMs}
              />
              <div className="flex items-center justify-between pl-22 font-mono text-[11px] text-muted-foreground">
                <span>00:00.0</span>
                <span>{formatTimecodeMs(trackTotalMs)}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                {comparison.first.annotator} 的片段 × 与{' '}
                {comparison.second.annotator} 的重叠
              </CardTitle>
              <CardDescription>
                重叠为 0 的片段是两人分歧点，优先复核这些位置（对照标注指引或打回重标）。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>片段区间</TableHead>
                    <TableHead>备注</TableHead>
                    <TableHead className="text-right">片段时长</TableHead>
                    <TableHead className="text-right">与对方重叠</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {comparison.pairRows.map((row) => (
                    <TableRow
                      key={row.index}
                      className={row.overlapMs === 0 ? 'bg-amber-50/40 dark:bg-amber-500/5' : ''}
                    >
                      <TableCell className="text-muted-foreground tabular-nums">
                        {row.index}
                      </TableCell>
                      <TableCell className="font-mono tabular-nums">
                        {row.range}
                      </TableCell>
                      <TableCell className="max-w-[16rem] truncate text-muted-foreground">
                        {row.note ?? '—'}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatDuration(row.durationMs)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatDuration(row.overlapMs)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="flex flex-wrap gap-2">
            <Link
              href={`/admin/tasks/${comparison.first.taskId}`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <GitCompareArrows data-icon="inline-start" />
              查看 {comparison.first.annotator} 的任务
            </Link>
            <Link
              href={`/admin/tasks/${comparison.second.taskId}`}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <GitCompareArrows data-icon="inline-start" />
              查看 {comparison.second.annotator} 的任务
            </Link>
          </div>
        </>
      ) : null}
    </div>
  )
}
