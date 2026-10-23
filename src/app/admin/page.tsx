import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import { AppHeader } from '@/components/app-header'
import { StatusBadge } from '@/components/status-badge'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { requireProfile } from '@/lib/auth'
import { formatShanghaiDateTime } from '@/lib/format'
import { relationField } from '@/lib/relations'
import { createClient } from '@/lib/supabase/server'
import type { TaskStatus } from '@/lib/types'
import { CreateTaskForm } from './create-task-form'

type TenantRow = { id: string; name: string }
type VideoRow = { id: string; title: string }

type AdminTaskRow = {
  id: string
  title: string
  video_id: string
  status: TaskStatus
  submitted_at: string | null
  tenant: unknown
  assignee: unknown
  video: unknown
}

type AdminPageProps = {
  searchParams: Promise<{ video?: string }>
}

function SummaryCard({
  label,
  value,
}: {
  label: string
  value: number
}) {
  return (
    <Card size="sm">
      <CardContent>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  )
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const profile = await requireProfile('admin')
  const params = await searchParams
  const supabase = await createClient()

  const [{ data: tenantData }, { data: videoData }, { data: taskData, error: taskError }] =
    await Promise.all([
      supabase.from('tenants').select('id, name').order('name'),
      supabase.from('videos').select('id, title').order('created_at', { ascending: false }),
      supabase
        .from('tasks')
        .select(
          'id, title, video_id, status, submitted_at, tenant:tenants(name), assignee:profiles!tasks_assignee_id_fkey(display_name), video:videos(id, url, title)'
        )
        .order('created_at', { ascending: false }),
    ])

  if (taskError) {
    throw new Error(taskError.message)
  }

  const tenants = (tenantData ?? []) as TenantRow[]
  const videos = (videoData ?? []) as VideoRow[]
  const tasks = (taskData ?? []) as AdminTaskRow[]
  const videoFilter =
    params.video && videos.some((video) => video.id === params.video)
      ? params.video
      : undefined
  const visibleTasks = videoFilter
    ? tasks.filter((task) => task.video_id === videoFilter)
    : tasks

  const statusCounts = {
    unassigned: visibleTasks.filter((task) => task.status === 'unassigned')
      .length,
    claimed: visibleTasks.filter((task) => task.status === 'claimed').length,
    submitted: visibleTasks.filter((task) => task.status === 'submitted')
      .length,
  }

  return (
    <>
      <AppHeader profile={profile} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">任务管理</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              发布任务并指定视频与租户，标注员只能看到本租户任务。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/admin/videos"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              视频库
            </Link>
            <Link
              href="/admin/stats"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              查看工作量统计
            </Link>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryCard label="全部任务" value={visibleTasks.length} />
          <SummaryCard label="待领取" value={statusCounts.unassigned} />
          <SummaryCard label="标注中" value={statusCounts.claimed} />
          <SummaryCard label="已提交" value={statusCounts.submitted} />
        </div>

        <Card className="mb-4">
          <CardContent>
            <form method="get" className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="videoFilter">按视频筛选</Label>
                <select
                  id="videoFilter"
                  name="video"
                  defaultValue={videoFilter ?? 'all'}
                  className="h-8 w-64 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                >
                  <option value="all">全部视频</option>
                  {videos.map((video) => (
                    <option key={video.id} value={video.id}>
                      {video.title}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" variant="outline">
                筛选
              </Button>
              {videoFilter ? (
                <Link
                  href="/admin"
                  className={buttonVariants({ variant: 'ghost' })}
                >
                  重置
                </Link>
              ) : null}
            </form>
          </CardContent>
        </Card>

        <div className="grid items-start gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle>发布任务</CardTitle>
              <CardDescription>
                从视频库选择视频并指定租户，发布后立即进入该租户的任务池。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CreateTaskForm tenants={tenants} videos={videos} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>全部任务</CardTitle>
              <CardDescription>
                共 {visibleTasks.length} 个任务，按创建时间倒序。
              </CardDescription>
            </CardHeader>
            <CardContent>
              {visibleTasks.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {tasks.length === 0
                    ? '还没有任务，先在左侧发布一个。'
                    : '所选视频下还没有任务。'}
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>任务</TableHead>
                      <TableHead>视频</TableHead>
                      <TableHead>租户</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>标注员</TableHead>
                      <TableHead>提交时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleTasks.map((task) => {
                      const videoTitle = relationField(task.video, 'title')
                      const videoUrl = relationField(task.video, 'url')
                      return (
                        <TableRow key={task.id}>
                          <TableCell className="max-w-[14rem] truncate font-medium">
                            <Link
                              href={`/admin/tasks/${task.id}`}
                              className="hover:underline"
                            >
                              {task.title}
                            </Link>
                          </TableCell>
                          <TableCell className="max-w-[14rem]">
                            {videoTitle ? (
                              <span className="flex items-center gap-1">
                                <Link
                                  href={`/admin/?video=${task.video_id}`}
                                  className="truncate hover:underline"
                                  title={videoTitle}
                                >
                                  {videoTitle}
                                </Link>
                                <a
                                  href={videoUrl ?? '#'}
                                  target="_blank"
                                  rel="noreferrer"
                                  aria-label="打开原始视频"
                                  className="shrink-0 text-muted-foreground hover:text-primary"
                                >
                                  <ExternalLink className="size-3.5" />
                                </a>
                              </span>
                            ) : (
                              '—'
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {relationField(task.tenant, 'name') ?? '—'}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={task.status} />
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {relationField(task.assignee, 'display_name') ?? '—'}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatShanghaiDateTime(task.submitted_at)}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  )
}
