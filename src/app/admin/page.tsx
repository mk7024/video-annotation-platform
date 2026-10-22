import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
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

type AdminTaskRow = {
  id: string
  title: string
  video_url: string
  status: TaskStatus
  submitted_at: string | null
  tenant: unknown
  assignee: unknown
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

export default async function AdminPage() {
  const profile = await requireProfile('admin')
  const supabase = await createClient()

  const [{ data: tenantData }, { data: taskData, error: taskError }] =
    await Promise.all([
      supabase.from('tenants').select('id, name').order('name'),
      supabase
        .from('tasks')
        .select(
          'id, title, video_url, status, submitted_at, tenant:tenants(name), assignee:profiles!tasks_assignee_id_fkey(display_name)'
        )
        .order('created_at', { ascending: false }),
    ])

  if (taskError) {
    throw new Error(taskError.message)
  }

  const tenants = (tenantData ?? []) as TenantRow[]
  const tasks = (taskData ?? []) as AdminTaskRow[]

  const statusCounts = {
    unassigned: tasks.filter((task) => task.status === 'unassigned').length,
    claimed: tasks.filter((task) => task.status === 'claimed').length,
    submitted: tasks.filter((task) => task.status === 'submitted').length,
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
          <Link
            href="/admin/stats"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            查看工作量统计
          </Link>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryCard label="全部任务" value={tasks.length} />
          <SummaryCard label="待领取" value={statusCounts.unassigned} />
          <SummaryCard label="标注中" value={statusCounts.claimed} />
          <SummaryCard label="已提交" value={statusCounts.submitted} />
        </div>

        <div className="grid items-start gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle>发布任务</CardTitle>
              <CardDescription>
                选择租户和视频链接，发布后立即进入该租户的任务池。
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CreateTaskForm tenants={tenants} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>全部任务</CardTitle>
              <CardDescription>
                共 {tasks.length} 个任务，按创建时间倒序。
              </CardDescription>
            </CardHeader>
            <CardContent>
              {tasks.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  还没有任务，先在左侧发布一个。
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>任务</TableHead>
                      <TableHead>租户</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>标注员</TableHead>
                      <TableHead>提交时间</TableHead>
                      <TableHead className="text-right">视频</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {tasks.map((task) => (
                      <TableRow key={task.id}>
                        <TableCell className="max-w-[16rem] truncate font-medium">
                          <Link
                            href={`/admin/tasks/${task.id}`}
                            className="hover:underline"
                          >
                            {task.title}
                          </Link>
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
                        <TableCell className="text-right">
                          <a
                            href={task.video_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                          >
                            打开
                            <ExternalLink className="size-3.5" />
                          </a>
                        </TableCell>
                      </TableRow>
                    ))}
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
