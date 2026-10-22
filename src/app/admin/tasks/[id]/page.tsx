import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { AppHeader } from '@/components/app-header'
import { AnnotationWorkspace } from '@/components/annotation-workspace'
import { StatusBadge } from '@/components/status-badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { requireProfile } from '@/lib/auth'
import { formatDuration, formatShanghaiDateTime } from '@/lib/format'
import { relationField } from '@/lib/relations'
import { createClient } from '@/lib/supabase/server'
import type { TaskStatus } from '@/lib/types'
import { AdminTaskControls } from './admin-task-controls'

type AdminTaskDetail = {
  id: string
  title: string
  video_url: string
  status: TaskStatus
  submitted_at: string | null
  tenant: unknown
  assignee: unknown
}

type SegmentRow = {
  id: string
  start_ms: number
  end_ms: number
  note: string | null
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <Card size="sm">
      <CardContent>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 truncate text-sm font-medium">{value}</p>
      </CardContent>
    </Card>
  )
}

export default async function AdminTaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const profile = await requireProfile('admin')
  const supabase = await createClient()

  const { data } = await supabase
    .from('tasks')
    .select(
      'id, title, video_url, status, submitted_at, tenant:tenants(name), assignee:profiles!tasks_assignee_id_fkey(display_name)'
    )
    .eq('id', id)
    .maybeSingle()

  if (!data) {
    notFound()
  }

  const task = data as AdminTaskDetail
  const tenantName = relationField(task.tenant, 'name')
  const assigneeName = relationField(task.assignee, 'display_name')

  const { data: segmentData } = await supabase
    .from('segments')
    .select('id, start_ms, end_ms, note')
    .eq('task_id', task.id)
    .order('start_ms')

  const segments = ((segmentData ?? []) as SegmentRow[]).map((segment) => ({
    startMs: segment.start_ms,
    endMs: segment.end_ms,
    note: segment.note,
  }))

  const effectiveMs = segments.reduce(
    (sum, segment) => sum + (segment.endMs - segment.startMs),
    0
  )

  return (
    <>
      <AppHeader profile={profile} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Link
          href="/admin"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          返回任务管理
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
              每个已提交任务的时间段列表与备注，供核对每日工作量。
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

        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <InfoTile label="租户" value={tenantName ?? '—'} />
          <InfoTile label="标注员" value={assigneeName ?? '未领取'} />
          <InfoTile
            label="提交时间"
            value={
              task.submitted_at
                ? formatShanghaiDateTime(task.submitted_at)
                : '未提交'
            }
          />
          <InfoTile
            label="有效时长"
            value={
              task.status === 'submitted'
                ? `${formatDuration(effectiveMs)} · ${segments.length} 段`
                : '未提交不计'
            }
          />
        </div>

        <AdminTaskControls
          taskId={task.id}
          title={task.title}
          videoUrl={task.video_url}
          tenantName={tenantName}
          assigneeName={assigneeName}
          status={task.status}
          submittedAt={task.submitted_at}
          segments={segments}
        />

        {task.status === 'submitted' ? null : (
          <div className="mb-4 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            该任务尚未提交，以下时间段为当前草稿，不计入有效工时。
          </div>
        )}

        <AnnotationWorkspace
          taskId={task.id}
          videoUrl={task.video_url}
          initialSegments={segments}
          readOnly
        />
      </main>
    </>
  )
}
