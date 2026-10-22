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
  video_url: string
  status: TaskStatus
  assignee_id: string | null
  submitted_at: string | null
  assignee: unknown
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
      'id, title, video_url, status, assignee_id, submitted_at, assignee:profiles!tasks_assignee_id_fkey(display_name)'
    )
    .eq('id', id)
    .maybeSingle()

  if (!data) {
    notFound()
  }

  const task = data as TaskDetail
  const assigneeName = relationField(task.assignee, 'display_name')
  const isMine = task.assignee_id === profile.id
  const isUnassigned = task.status === 'unassigned'
  const claimedByOther = task.status === 'claimed' && !isMine
  const canEdit = task.status === 'claimed' && isMine
  const readOnly = task.status === 'submitted'

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
              <h1 className="text-xl font-semibold tracking-tight">{task.title}</h1>
              <StatusBadge status={task.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              租户：{profile.tenant_name ?? '—'}
              {assigneeName ? ` · 领取人：${assigneeName}` : ''}
              {task.submitted_at
                ? ` · 提交于 ${formatShanghaiDateTime(task.submitted_at)}`
                : ''}
            </p>
          </div>
          <a
            href={task.video_url}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            <ExternalLink data-icon="inline-start" />
            原始视频
          </a>
        </div>

        {isUnassigned ? (
          <Card>
            <CardHeader>
              <CardTitle>任务还未领取</CardTitle>
              <CardDescription>
                领取后任务会锁定给你，再开始标注时间段。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form action={claimTaskAction}>
                <input type="hidden" name="taskId" value={task.id} />
                <button type="submit" className={buttonVariants()}>
                  领取任务
                </button>
              </form>
            </CardContent>
          </Card>
        ) : claimedByOther ? (
          <Card>
            <CardHeader>
              <CardTitle>任务已被领取</CardTitle>
              <CardDescription>
                {assigneeName ?? '其他标注员'} 正在标注这个任务，当前不可编辑。
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="flex flex-col gap-4">
            {readOnly ? (
              <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                该任务已提交，以下时间段仅供查看。有效时长计入提交当天。
              </div>
            ) : null}
            <AnnotationWorkspace
              taskId={task.id}
              videoUrl={task.video_url}
              initialSegments={segments}
              readOnly={readOnly}
            />
          </div>
        )}
      </main>
    </>
  )
}
