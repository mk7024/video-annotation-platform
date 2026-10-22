import type { TaskStatus } from '@/lib/types'

const STATUS_MAP: Record<
  TaskStatus,
  { label: string; className: string }
> = {
  unassigned: {
    label: '待领取',
    className: 'border-border bg-muted text-muted-foreground',
  },
  claimed: {
    label: '标注中',
    className: 'border-primary/20 bg-primary/10 text-primary',
  },
  submitted: {
    label: '已提交',
    className:
      'border-emerald-600/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  },
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  const item = STATUS_MAP[status]

  return (
    <span
      className={`inline-flex h-5 items-center rounded-md border px-2 text-xs font-medium whitespace-nowrap ${item.className}`}
    >
      {item.label}
    </span>
  )
}
