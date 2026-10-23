import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { AppHeader } from '@/components/app-header'
import { buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { requireProfile } from '@/lib/auth'
import { relationField } from '@/lib/relations'
import { createClient } from '@/lib/supabase/server'
import { CompareBoard } from './compare-board'

type VideoRow = {
  id: string
  title: string
  duration_ms: number | null
  dataset: string | null
}

type SubmittedTaskRow = {
  id: string
  title: string
  submitted_at: string | null
  assignee: unknown
}

type SegmentRow = {
  task_id: string
  start_ms: number
  end_ms: number
  note: string | null
}

type ComparePageProps = {
  searchParams: Promise<{ video?: string }>
}

export default async function ComparePage({ searchParams }: ComparePageProps) {
  const profile = await requireProfile('admin')
  const { video: videoId } = await searchParams
  const supabase = await createClient()

  if (!videoId) {
    notFound()
  }

  const { data: videoData } = await supabase
    .from('videos')
    .select('id, title, duration_ms, dataset')
    .eq('id', videoId)
    .maybeSingle()

  if (!videoData) {
    notFound()
  }

  const video = videoData as VideoRow

  const { data: taskData } = await supabase
    .from('tasks')
    .select(
      'id, title, submitted_at, assignee:profiles!tasks_assignee_id_fkey(display_name)'
    )
    .eq('video_id', video.id)
    .eq('status', 'submitted')
    .order('submitted_at', { ascending: false })

  const tasks = (taskData ?? []) as SubmittedTaskRow[]

  const segmentsByTask = new Map<string, SegmentRow[]>()
  if (tasks.length > 0) {
    const { data: segmentData } = await supabase
      .from('segments')
      .select('task_id, start_ms, end_ms, note')
      .in(
        'task_id',
        tasks.map((task) => task.id)
      )
      .order('start_ms')

    for (const segment of (segmentData ?? []) as SegmentRow[]) {
      const list = segmentsByTask.get(segment.task_id) ?? []
      list.push(segment)
      segmentsByTask.set(segment.task_id, list)
    }
  }

  const submissions = tasks.map((task) => ({
    taskId: task.id,
    title: task.title,
    annotator: relationField(task.assignee, 'display_name') ?? '未知',
    submittedAt: task.submitted_at,
    segments: segmentsByTask.get(task.id) ?? [],
  }))

  return (
    <>
      <AppHeader profile={profile} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Link
          href="/admin/videos"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          返回视频库
        </Link>

        <div className="mb-5">
          <h1 className="text-xl font-semibold tracking-tight">
            标注一致性比对{video.dataset ? ` · ${video.dataset}` : ''}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            视频「{video.title}」共有 {submissions.length} 份已提交标注。
          </p>
        </div>

        {submissions.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>暂无比对对象</CardTitle>
              <CardDescription>
                该视频还没有已提交的标注任务；对同一视频发布多个任务、两人独立完成后即可在此比对。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/admin" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                去发布任务
              </Link>
            </CardContent>
          </Card>
        ) : (
          <CompareBoard
            videoTitle={video.title}
            videoDurationMs={video.duration_ms}
            submissions={submissions}
          />
        )}
      </main>
    </>
  )
}
