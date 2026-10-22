import Link from 'next/link'
import { Suspense } from 'react'
import { AppHeader } from '@/components/app-header'
import { StatusBadge } from '@/components/status-badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { requireProfile } from '@/lib/auth'
import { formatShanghaiDateTime } from '@/lib/format'
import { relationField } from '@/lib/relations'
import { createClient } from '@/lib/supabase/server'
import type { Profile, TaskStatus } from '@/lib/types'
import { claimTaskAction } from './actions'

type TaskRow = {
  id: string
  title: string
  status: TaskStatus
  assignee_id: string | null
  submitted_at: string | null
  assignee: unknown
}

type TasksPageProps = {
  searchParams: Promise<{ error?: string }>
}

function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string
  value: number
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
}: {
  profile: Profile
  error?: string
}) {
  const supabase = await createClient()

  const { data, error: queryError } = await supabase
    .from('tasks')
    .select(
      'id, title, status, assignee_id, submitted_at, assignee:profiles!tasks_assignee_id_fkey(display_name)'
    )
    .eq('tenant_id', profile.tenant_id!)
    .order('created_at', { ascending: false })

  if (queryError) {
    throw new Error(queryError.message)
  }

  const tasks = (data ?? []) as TaskRow[]
  const available = tasks.filter((task) => task.status === 'unassigned')
  const mineInProgress = tasks.filter(
    (task) => task.status === 'claimed' && task.assignee_id === profile.id
  )
  const mineSubmitted = tasks.filter(
    (task) => task.status === 'submitted' && task.assignee_id === profile.id
  )

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">我的任务</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          当前租户：{profile.tenant_name ?? '—'} · 只能看到本租户的任务
        </p>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard label="待领取" value={available.length} hint="本租户" />
        <SummaryCard
          label="我的进行中"
          value={mineInProgress.length}
          hint="草稿可继续编辑"
        />
        <SummaryCard
          label="我的已提交"
          value={mineSubmitted.length}
          hint="计入有效工时"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>任务列表</CardTitle>
          <CardDescription>
            领取后任务锁定给你，其他标注员不能重复领取。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {tasks.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              本租户还没有任务，等管理员发布。
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>任务</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>领取人</TableHead>
                  <TableHead>提交时间</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((task) => {
                  const assigneeName = relationField(task.assignee, 'display_name')
                  const isMine = task.assignee_id === profile.id

                  return (
                    <TableRow key={task.id}>
                      <TableCell className="max-w-[22rem] truncate font-medium">
                        <Link
                          href={`/tasks/${task.id}`}
                          className="hover:underline"
                        >
                          {task.title}
                        </Link>
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
                        ) : task.status === 'submitted' ? (
                          <Link
                            href={`/tasks/${task.id}`}
                            className={buttonVariants({
                              variant: 'outline',
                              size: 'sm',
                            })}
                          >
                            查看片段
                          </Link>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            已被领取
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
    </div>
  )
}

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const { error } = await searchParams
  const profile = await requireProfile('annotator')

  return (
    <>
      <AppHeader profile={profile} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Suspense fallback={<p className="text-sm text-muted-foreground">加载中…</p>}>
          <TaskList profile={profile} error={error} />
        </Suspense>
      </main>
    </>
  )
}
