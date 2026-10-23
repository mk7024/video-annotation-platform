import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { AppHeader } from '@/components/app-header'
import { StatusBadge } from '@/components/status-badge'
import { buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { requireProfile } from '@/lib/auth'
import { formatShanghaiDateTime } from '@/lib/format'
import { relationField } from '@/lib/relations'
import { createClient } from '@/lib/supabase/server'
import type { SegmentInput, TaskStatus } from '@/lib/types'
import { claimTaskAction } from '../actions'
import { AnnotationWorkspace } from '@/components/annotation-workspace'

type TaskDetail = {
  id: string
  title: string
  guideline: string | null
  labels: string[] | null
  reopen_note: string | null
  status: TaskStatus
  assignee_id: string | null
  submitted_at: string | null
  assignee: unknown
  video: unknown
}

type SegmentRow = {
  id: string
  start_ms: number
  end_ms: number
  note: string | null
}

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const profile = await requireProfile('annotator')
  const supabase = await createClient()

  const { data } = await supabase
    .from('tasks')
    .select(
      'id, title, guideline, labels, reopen_note, status, assignee_id, submitted_at, assignee:profiles!tasks_assignee_id_fkey(display_name), video:videos(id, url, title, dataset, duration_ms)'
    )
    .eq('id', id)
    .maybeSingle()

  if (!data) {
    notFound()
  }

  const task = data as TaskDetail
  const assigneeName = relationField(task.assignee, 'display_name')
  const videoId = relationField(task.video, 'id')
  const videoUrl = relationField(task.video, 'url')
  const videoTitle = relationField(task.video, 'title')
  const videoDataset = relationField(task.video, 'dataset')
  const videoDurationMs = Number(
    (task.video as { duration_ms?: number | null } | null)?.duration_ms ?? 0
  )
  const isMine = task.assignee_id === profile.id
  const isUnassigned = task.status === 'unassigned'
  const ownedByOther = !isUnassigned && !isMine
  const canEdit = task.status === 'claimed' && isMine
  const readOnly = task.status === 'submitted' && isMine

  let segments: SegmentInput[] = []
  if (canEdit || readOnly) {
    const { data: segmentData } = await supabase
      .from('segments')
      .select('id, start_ms, end_ms, note')
      .eq('task_id', task.id)
      .order('start_ms')

    segments = ((segmentData ?? []) as SegmentRow[]).map((segment) => ({
      startMs: segment.start_ms,
      endMs: segment.end_ms,
      note: segment.note,
    }))
  }

  return (
    <>
      <AppHeader profile={profile} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Link
          href="/tasks"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          返回任务列表
        </Link>

        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">
                {task.title}
              </h1>
              <StatusBadge status={task.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              视频：{videoTitle ?? '—'}
              {videoDataset ? `（${videoDataset}）` : ''}
              {` · 租户：${profile.tenant_name ?? '—'}`}
              {assigneeName ? ` · 领取人：${assigneeName}` : ''}
              {task.submitted_at
                ? ` · 提交于 ${formatShanghaiDateTime(task.submitted_at)}`
                : ''}
            </p>
          </div>
          {videoUrl ? (
            <a
              href={videoUrl}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              <ExternalLink data-icon="inline-start" />
              原始视频
            </a>
          ) : null}
        </div>

        {isUnassigned ? (
          <Card>
            <CardHeader>
              <CardTitle>任务还未领取</CardTitle>
              <CardDescription>
                领取后任务会锁定给你，再开始标注时间段。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {task.guideline ? (
                <div className="rounded-lg border border-amber-300/60 bg-amber-50/60 px-3 py-2.5 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
                  <p className="font-medium text-amber-900 dark:text-amber-300">
                    标注指引
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-amber-900/80 dark:text-amber-200/80">
                    {task.guideline}
                  </p>
                </div>
              ) : null}
              <form action={claimTaskAction}>
                <input type="hidden" name="taskId" value={task.id} />
                <button type="submit" className={buttonVariants()}>
                  领取任务
                </button>
              </form>
            </CardContent>
          </Card>
        ) : ownedByOther ? (
          <Card>
            <CardHeader>
              <CardTitle>
                {task.status === 'submitted'
                  ? '该任务已由其他标注员提交'
                  : '任务已被其他标注员领取'}
              </CardTitle>
              <CardDescription>
                由同租户标注员 {assigneeName ?? '其他成员'} 负责，为保障标注独立性，仅本人与管理员可查看标注片段。
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="flex flex-col gap-4">
            {canEdit && task.reopen_note ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm">
                <p className="font-medium text-destructive">
                  该任务被管理员打回，请按下面的原因修改后重新提交
                </p>
                <p className="mt-1 whitespace-pre-wrap text-foreground/80">
                  {task.reopen_note}
                </p>
              </div>
            ) : null}
            {readOnly ? (
              <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                该任务已提交，以下时间段仅供查看。如需修改可联系管理员打回重标。
              </div>
            ) : null}
            <AnnotationWorkspace
              taskId={task.id}
              videoUrl={videoUrl ?? ''}
              videoId={videoId ?? undefined}
              initialDurationMs={videoDurationMs > 0 ? videoDurationMs : null}
              guideline={task.guideline}
              labels={task.labels}
              initialSegments={segments}
              readOnly={readOnly}
            />
          </div>
        )}
      </main>
    </>
  )
}
