'use client'

import { useActionState, useState } from 'react'
import { Plus } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createTaskAction, type CreateTaskState } from './actions'

const VIDEO_PRESETS = [
  {
    label: 'Push-T 推方块（约 7 MB）',
    url: 'https://huggingface.co/datasets/lerobot/pusht/resolve/main/videos/observation.image/chunk-000/file-000.mp4',
  },
  {
    label: 'ALOHA 双臂做咖啡（约 500 MB）',
    url: 'https://huggingface.co/datasets/lerobot/aloha_static_coffee/resolve/main/videos/observation.images.cam_high/chunk-000/file-000.mp4',
  },
]

type TenantOption = { id: string; name: string }

const initialState: CreateTaskState = {}

export function CreateTaskForm({ tenants }: { tenants: TenantOption[] }) {
  const [state, formAction, pending] = useActionState(
    createTaskAction,
    initialState
  )
  const [videoUrl, setVideoUrl] = useState('')

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="title">任务名称</Label>
        <Input
          id="title"
          name="title"
          placeholder="例如：ALOHA 咖啡制作 · 有效片段标注"
          required
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="tenantId">所属租户</Label>
        <select
          id="tenantId"
          name="tenantId"
          required
          defaultValue={tenants[0]?.id ?? ''}
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        >
          {tenants.map((tenant) => (
            <option key={tenant.id} value={tenant.id}>
              {tenant.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="preset">示例视频</Label>
        <select
          id="preset"
          defaultValue=""
          onChange={(event) => {
            if (event.target.value) {
              setVideoUrl(event.target.value)
            }
          }}
          className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        >
          <option value="">自定义链接</option>
          {VIDEO_PRESETS.map((preset) => (
            <option key={preset.url} value={preset.url}>
              {preset.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="videoUrl">视频链接</Label>
        <Input
          id="videoUrl"
          name="videoUrl"
          value={videoUrl}
          onChange={(event) => setVideoUrl(event.target.value)}
          placeholder="https://…/video.mp4"
          required
        />
        <p className="text-xs text-muted-foreground">
          直接使用可访问的 MP4 链接，视频不占用数据库存储。
        </p>
      </div>

      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      {state.success ? (
        <p className="text-sm text-emerald-700 dark:text-emerald-400">
          {state.success}
        </p>
      ) : null}

      <Button type="submit" disabled={pending || tenants.length === 0}>
        <Plus data-icon="inline-start" />
        {pending ? '发布中…' : '发布任务'}
      </Button>
    </form>
  )
}
