import Link from 'next/link'
import { AppHeader } from '@/components/app-header'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { requireProfile } from '@/lib/auth'
import { formatDuration } from '@/lib/format'
import { createClient } from '@/lib/supabase/server'
import {
  StatsExportBar,
  type TaskDatasetExportItem,
} from './stats-export-bar'

type TenantRow = { id: string; name: string }

type WorkloadRow = {
  task_id: string
  tenant_id: string
  tenant_name: string
  title: string
  annotator_name: string | null
  submitted_date: string
  effective_ms: number | string
}

type StatsPageProps = {
  searchParams: Promise<{ tenant?: string; from?: string; to?: string }>
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function formatDateOnly(date: string): string {
  const [year, month, day] = date.split('-')
  return `${year} 年 ${Number(month)} 月 ${Number(day)} 日`
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
      <CardContent>
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  )
}

export default async function StatsPage({ searchParams }: StatsPageProps) {
  const profile = await requireProfile('admin')
  const params = await searchParams
  const supabase = await createClient()

  const { data: tenantData } = await supabase
    .from('tenants')
    .select('id, name')
    .order('name')

  const tenants = (tenantData ?? []) as TenantRow[]
  const tenantFilter = tenants.some((tenant) => tenant.id === params.tenant)
    ? params.tenant
    : undefined
  const from = DATE_PATTERN.test(params.from ?? '') ? params.from : undefined
  const to = DATE_PATTERN.test(params.to ?? '') ? params.to : undefined

  let query = supabase
    .from('task_workloads')
    .select(
      'task_id, tenant_id, tenant_name, title, annotator_name, submitted_date, effective_ms'
    )

  if (tenantFilter) {
    query = query.eq('tenant_id', tenantFilter)
  }
  if (from) {
    query = query.gte('submitted_date', from)
  }
  if (to) {
    query = query.lte('submitted_date', to)
  }

  const { data: workloadData, error } = await query
  if (error) {
    throw new Error(error.message)
  }

  const rows = (workloadData ?? []) as WorkloadRow[]
  const dailyMap = new Map<string, { date: string; tasks: number; ms: number }>()

  for (const row of rows) {
    const current = dailyMap.get(row.submitted_date) ?? {
      date: row.submitted_date,
      tasks: 0,
      ms: 0,
    }
    current.tasks += 1
    current.ms += Number(row.effective_ms ?? 0)
    dailyMap.set(row.submitted_date, current)
  }

  const daily = [...dailyMap.values()].sort((a, b) =>
    b.date.localeCompare(a.date)
  )
  const totalMs = daily.reduce((sum, day) => sum + day.ms, 0)
  const totalTasks = daily.reduce((sum, day) => sum + day.tasks, 0)
  const maxDailyMs = Math.max(1, ...daily.map((day) => day.ms))

  const annotatorMap = new Map<
    string,
    { name: string; tenant: string; tasks: number; ms: number }
  >()
  for (const row of rows) {
    const key = `${row.annotator_name ?? '未知'}|${row.tenant_name}`
    const current = annotatorMap.get(key) ?? {
      name: row.annotator_name ?? '未知',
      tenant: row.tenant_name,
      tasks: 0,
      ms: 0,
    }
    current.tasks += 1
    current.ms += Number(row.effective_ms ?? 0)
    annotatorMap.set(key, current)
  }
  const byAnnotator = [...annotatorMap.values()].sort(
    (a, b) => b.ms - a.ms || a.name.localeCompare(b.name)
  )

  const detailRows = [...rows].sort(
    (a, b) =>
      b.submitted_date.localeCompare(a.submitted_date) ||
      Number(b.effective_ms ?? 0) - Number(a.effective_ms ?? 0)
  )

  const submittedTaskIds = detailRows.map((r) => r.task_id)
  const videoUrlMap = new Map<string, string>()
  const segmentsByTaskMap = new Map<
    string,
    Array<{ start_ms: number; end_ms: number; note: string | null }>
  >()

  if (submittedTaskIds.length > 0) {
    const [{ data: taskMeta }, { data: segData }] = await Promise.all([
      supabase
        .from('tasks')
        .select('id, video_url')
        .in('id', submittedTaskIds),
      supabase
        .from('segments')
        .select('task_id, start_ms, end_ms, note')
        .in('task_id', submittedTaskIds)
        .order('start_ms'),
    ])

    for (const item of (taskMeta ?? []) as Array<{
      id: string
      video_url: string
    }>) {
      videoUrlMap.set(item.id, item.video_url)
    }

    for (const seg of (segData ?? []) as Array<{
      task_id: string
      start_ms: number
      end_ms: number
      note: string | null
    }>) {
      const list = segmentsByTaskMap.get(seg.task_id) ?? []
      list.push({
        start_ms: seg.start_ms,
        end_ms: seg.end_ms,
        note: seg.note,
      })
      segmentsByTaskMap.set(seg.task_id, list)
    }
  }

  const exportDataset: TaskDatasetExportItem[] = detailRows.map((row) => ({
    task_id: row.task_id,
    title: row.title,
    tenant_name: row.tenant_name,
    annotator_name: row.annotator_name,
    video_url: videoUrlMap.get(row.task_id) ?? '',
    submitted_date: row.submitted_date,
    effective_ms: Number(row.effective_ms ?? 0),
    segments: segmentsByTaskMap.get(row.task_id) ?? [],
  }))

  return (
    <>
      <AppHeader profile={profile} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">工作量统计</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              仅统计已提交任务，有效时长计入提交当天（Asia/Shanghai），支持一键导出对账单与训练数据集。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatsExportBar daily={daily} dataset={exportDataset} />
            <Link
              href="/admin"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              返回任务管理
            </Link>
          </div>
        </div>

        <Card className="mb-4">
          <CardContent>
            <form method="get" className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="tenant">租户</Label>
                <select
                  id="tenant"
                  name="tenant"
                  defaultValue={tenantFilter ?? 'all'}
                  className="h-8 w-44 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                >
                  <option value="all">全部租户</option>
                  {tenants.map((tenant) => (
                    <option key={tenant.id} value={tenant.id}>
                      {tenant.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="from">开始日期</Label>
                <Input
                  id="from"
                  name="from"
                  type="date"
                  defaultValue={from ?? ''}
                  className="w-40"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="to">结束日期</Label>
                <Input
                  id="to"
                  name="to"
                  type="date"
                  defaultValue={to ?? ''}
                  className="w-40"
                />
              </div>

              <Button type="submit" variant="outline">
                筛选
              </Button>
              <Link
                href="/admin/stats"
                className={buttonVariants({ variant: 'ghost' })}
              >
                重置
              </Link>
            </form>
          </CardContent>
        </Card>

        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <SummaryCard
            label="有效时长总计"
            value={formatDuration(totalMs)}
            hint="所选范围内的已提交任务"
          />
          <SummaryCard
            label="提交任务数"
            value={totalTasks}
            hint="每个任务按提交日计数"
          />
          <SummaryCard
            label="有提交的天数"
            value={daily.length}
            hint="只展示有工作量的日期"
          />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>每日有效时长</CardTitle>
            <CardDescription>
              有效时长 = 已提交任务中所有时间段长度之和；草稿和未提交任务不计入。
            </CardDescription>
          </CardHeader>
          <CardContent>
            {daily.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                当前筛选范围内还没有已提交任务。
                <br />
                运行 <code className="font-mono">npm run seed</code>{' '}
                可以写入演示数据。
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>日期</TableHead>
                    <TableHead>提交任务数</TableHead>
                    <TableHead>有效时长</TableHead>
                    <TableHead className="hidden md:table-cell">相对工作量</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {daily.map((day) => (
                    <TableRow key={day.date}>
                      <TableCell className="font-medium">
                        {formatDateOnly(day.date)}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {day.tasks}
                      </TableCell>
                      <TableCell className="font-medium tabular-nums">
                        {formatDuration(day.ms)}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <div className="h-1.5 w-full max-w-48 rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-emerald-500/70"
                            style={{
                              width: `${Math.max(
                                4,
                                (day.ms / maxDailyMs) * 100
                              )}%`,
                            }}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell>合计</TableCell>
                    <TableCell className="tabular-nums">{totalTasks}</TableCell>
                    <TableCell className="font-semibold tabular-nums">
                      {formatDuration(totalMs)}
                    </TableCell>
                    <TableCell className="hidden md:table-cell" />
                  </TableRow>
                </TableFooter>
              </Table>
            )}
          </CardContent>
        </Card>

        {rows.length > 0 ? (
          <div className="mt-4 grid items-start gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>按标注员</CardTitle>
                <CardDescription>
                  所选范围内各标注员的提交任务数与有效时长。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>标注员</TableHead>
                      <TableHead>租户</TableHead>
                      <TableHead>任务数</TableHead>
                      <TableHead>有效时长</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {byAnnotator.map((item) => (
                      <TableRow key={`${item.tenant}-${item.name}`}>
                        <TableCell className="font-medium">
                          {item.name}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {item.tenant}
                        </TableCell>
                        <TableCell className="tabular-nums">
                          {item.tasks}
                        </TableCell>
                        <TableCell className="font-medium tabular-nums">
                          {formatDuration(item.ms)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>提交明细</CardTitle>
                <CardDescription>
                  每个已提交任务的片段合计，点任务名查看时间段列表。
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>日期</TableHead>
                      <TableHead>任务</TableHead>
                      <TableHead>标注员</TableHead>
                      <TableHead>有效时长</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detailRows.map((row) => (
                      <TableRow key={row.task_id}>
                        <TableCell className="whitespace-nowrap text-muted-foreground">
                          {row.submitted_date}
                        </TableCell>
                        <TableCell className="max-w-[12rem] truncate font-medium">
                          <Link
                            href={`/admin/tasks/${row.task_id}`}
                            className="hover:underline"
                          >
                            {row.title}
                          </Link>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {row.annotator_name ?? '—'}
                        </TableCell>
                        <TableCell className="font-medium tabular-nums">
                          {formatDuration(Number(row.effective_ms ?? 0))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </main>
    </>
  )
}
