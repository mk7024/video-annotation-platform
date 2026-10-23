import Link from 'next/link'
import { Suspense } from 'react'
import { AppHeader } from '@/components/app-header'
import { StatusBadge } from '@/components/status-badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { formatDuration, formatShanghaiDateTime } from '@/lib/format'
import { relationField } from '@/lib/relations'
import { createClient } from '@/lib/supabase/server'
import type { Profile, TaskStatus } from '@/lib/types'
import { claimTaskAction } from './actions'

type TaskRow = {
  id: string
  title: string
  status: TaskStatus
  video_id: string
  assignee_id: string | null
  submitted_at: string | null
  assignee: unknown
  video: unknown
}

type VideoOption = { id: string; title: string; dataset: string | null }

type MyWorkloadRow = {
  task_id: string
  title: string
  submitted_date: string
  effective_ms: number | string
}

type TasksPageProps = {
  searchParams: Promise<{ error?: string; video?: string }>
}

function getTodayShanghaiDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string | number
  hint: string
}) {
  return (
    <Card size="sm">
      <CardContent className="flex items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        </div>
        <p className="pb-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  )
}

async function TaskList({
  profile,
  error,
  videoParam,
}: {
  profile: Profile
  error?: string
  videoParam?: string
}) {
  const supabase = await createClient()

  const [
    { data, error: queryError },
    { data: workloadData },
  ] = await Promise.all([
    supabase
      .from('tasks')
      .select(
        'id, title, status, video_id, assignee_id, submitted_at, assignee:profiles!tasks_assignee_id_fkey(display_name), video:videos(id, title, dataset)'
      )
      .eq('tenant_id', profile.tenant_id!)
      .order('created_at', { ascending: false }),
    supabase
      .from('task_workloads')
      .select('task_id, title, submitted_date, effective_ms')
      .eq('assignee_id', profile.id),
  ])

  if (queryError) {
    throw new Error(queryError.message)
  }

  const tasks = (data ?? []) as TaskRow[]
  const myWorkloads = (workloadData ?? []) as MyWorkloadRow[]

  const videoMap = new Map<string, VideoOption>()
  for (const task of tasks) {
    const id = relationField(task.video, 'id')
    if (id && !videoMap.has(id)) {
      videoMap.set(id, {
        id,
        title: relationField(task.video, 'title') ?? id,
        dataset: relationField(task.video, 'dataset'),
      })
    }
  }
  const videos = [...videoMap.values()]
  const videoFilter =
    videoParam && videoMap.has(videoParam) ? videoParam : undefined
  const visibleTasks = videoFilter
    ? tasks.filter((task) => task.video_id === videoFilter)
    : tasks

  const available = visibleTasks.filter((task) => task.status === 'unassigned')
  const mineInProgress = visibleTasks.filter(
    (task) => task.status === 'claimed' && task.assignee_id === profile.id
  )
  const mineSubmitted = visibleTasks.filter(
    (task) => task.status === 'submitted' && task.assignee_id === profile.id
  )

  const todayStr = getTodayShanghaiDate()
  const todayEffectiveMs = myWorkloads
    .filter((w) => w.submitted_date === todayStr)
    .reduce((sum, w) => sum + Number(w.effective_ms ?? 0), 0)
  const totalEffectiveMs = myWorkloads.reduce(
    (sum, w) => sum + Number(w.effective_ms ?? 0),
    0
  )

  const myDailyMap = new Map<
    string,
    { date: string; tasks: number; ms: number }
  >()
  for (const row of myWorkloads) {
    const current = myDailyMap.get(row.submitted_date) ?? {
      date: row.submitted_date,
      tasks: 0,
      ms: 0,
    }
    current.tasks += 1
    current.ms += Number(row.effective_ms ?? 0)
    myDailyMap.set(row.submitted_date, current)
  }
  const myDailyStats = [...myDailyMap.values()].sort((a, b) =>
    b.date.localeCompare(a.date)
  )

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">我的任务与工时</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          当前租户：{profile.tenant_name ?? '—'} ·
          后端租户隔离生效，工时统计口径与管理员完全一致
        </p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="待领取任务" value={available.length} hint="本租户池" />
        <SummaryCard
          label="我的进行中"
          value={mineInProgress.length}
          hint="草稿可随时保存"
        />
        <SummaryCard
          label="今日有效时长"
          value={formatDuration(todayEffectiveMs)}
          hint={`按提交日 (${todayStr})`}
        />
        <SummaryCard
          label="累计有效时长"
          value={formatDuration(totalEffectiveMs)}
          hint={`已提交 ${mineSubmitted.length} 个任务`}
        />
      </div>

      {videos.length > 1 ? (
        <Card size="sm">
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
                <Link href="/tasks" className={buttonVariants({ variant: 'ghost' })}>
                  重置
                </Link>
              ) : null}
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>任务列表</CardTitle>
          <CardDescription>
            领取后任务锁定给你；为避免互相参考答案，仅本人可查看自己标注的片段明细。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {visibleTasks.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {tasks.length === 0
                ? '本租户还没有任务，等管理员发布。'
                : '所选视频下还没有任务。'}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>任务</TableHead>
                  <TableHead className="hidden md:table-cell">视频</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>领取人</TableHead>
                  <TableHead>提交时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleTasks.map((task) => {
                  const assigneeName = relationField(
                    task.assignee,
                    'display_name'
                  )
                  const videoTitle = relationField(task.video, 'title')
                  const isMine = task.assignee_id === profile.id
                  const canOpenDetail =
                    task.status === 'unassigned' || isMine

                  return (
                    <TableRow key={task.id}>
                      <TableCell className="max-w-[16rem] truncate font-medium">
                        {canOpenDetail ? (
                          <Link
                            href={`/tasks/${task.id}`}
                            className="hover:underline"
                          >
                            {task.title}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">
                            {task.title}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="hidden max-w-[12rem] truncate text-muted-foreground md:table-cell">
                        {videoTitle ?? '—'}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={task.status} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {assigneeName ?? '—'}
                        {isMine ? '（我）' : ''}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatShanghaiDateTime(task.submitted_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        {task.status === 'unassigned' ? (
                          <form action={claimTaskAction} className="inline-flex">
                            <input
                              type="hidden"
                              name="taskId"
                              value={task.id}
                            />
                            <button
                              type="submit"
                              className={buttonVariants({ size: 'sm' })}
                            >
                              领取任务
                            </button>
                          </form>
                        ) : isMine && task.status === 'claimed' ? (
                          <Link
                            href={`/tasks/${task.id}`}
                            className={buttonVariants({ size: 'sm' })}
                          >
                            继续标注
                          </Link>
                        ) : isMine && task.status === 'submitted' ? (
                          <Link
                            href={`/tasks/${task.id}`}
                            className={buttonVariants({
                              variant: 'outline',
                              size: 'sm',
                            })}
                          >
                            查看我的片段
                          </Link>
                        ) : task.status === 'submitted' ? (
                          <span className="text-xs text-muted-foreground">
                            他人已提交
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            已被他人领取
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {myDailyStats.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>我的每日有效工时对账</CardTitle>
            <CardDescription>
              按任务提交当天（Asia/Shanghai）汇总已提交片段时长，与管理员后台统计实时同步。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>提交日期</TableHead>
                  <TableHead>已提交任务数</TableHead>
                  <TableHead>有效时长合计</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {myDailyStats.map((day) => (
                  <TableRow key={day.date}>
                    <TableCell className="font-medium">{day.date}</TableCell>
                    <TableCell className="tabular-nums">{day.tasks}</TableCell>
                    <TableCell className="font-medium tabular-nums">
                      {formatDuration(day.ms)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const { error, video } = await searchParams
  const profile = await requireProfile('annotator')

  return (
    <>
      <AppHeader profile={profile} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Suspense
          fallback={<p className="text-sm text-muted-foreground">加载中…</p>}
        >
          <TaskList profile={profile} error={error} videoParam={video} />
        </Suspense>
      </main>
    </>
  )
}
