'use client'

import { useActionState, useState } from 'react'
import { Layers, Plus } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createTaskAction, type CreateTaskState } from './actions'

type TenantOption = { id: string; name: string }
type VideoOption = { id: string; title: string; dataset?: string | null }

const SAMPLE_BATCH_TEXT = `Push-T 推方块 Episode 01 | https://huggingface.co/datasets/lerobot/pusht/resolve/main/videos/observation.image/chunk-000/file-000.mp4
ALOHA 双臂做咖啡 Episode 01 | https://huggingface.co/datasets/lerobot/aloha_static_coffee/resolve/main/videos/observation.images.cam_high/chunk-000/file-000.mp4`

const SAMPLE_GUIDELINE =
  '标出包含完整动作周期的有效片段；排除开头/结尾的机械臂复位与空闲等待段；单段不少于 2 秒，边界尽量对齐动作起止。'
const SAMPLE_LABELS = '抓取物体, 移动机械臂, 对准目标, 放置物体, 按压按钮, 机械臂复位'

const initialState: CreateTaskState = {}

export function CreateTaskForm({
  tenants,
  videos,
}: {
  tenants: TenantOption[]
  videos: VideoOption[]
}) {
  const [state, formAction, pending] = useActionState(
    createTaskAction,
    initialState
  )
  const [mode, setMode] = useState<'single' | 'batch'>('single')
  const [selectedVideoId, setSelectedVideoId] = useState(
    videos[0]?.id ?? 'custom'
  )
  const [videoUrl, setVideoUrl] = useState('')
  const [batchUrls, setBatchUrls] = useState('')
  const [guideline, setGuideline] = useState('')
  const [labels, setLabels] = useState('')

  const isCustomVideo = selectedVideoId === 'custom' || videos.length === 0

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="videoId" value={isCustomVideo ? '' : selectedVideoId} />

      <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-xs">
        <button
          type="button"
          onClick={() => setMode('single')}
          className={`rounded-md py-1.5 font-medium transition-colors ${
            mode === 'single'
              ? 'bg-background text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          单条发布
        </button>
        <button
          type="button"
          onClick={() => setMode('batch')}
          className={`rounded-md py-1.5 font-medium transition-colors ${
            mode === 'batch'
              ? 'bg-background text-foreground shadow-xs'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          批量发布
        </button>
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

      {mode === 'single' ? (
        <>
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
            <Label htmlFor="videoSelect">视频（视频库）</Label>
            <select
              id="videoSelect"
              value={isCustomVideo ? 'custom' : selectedVideoId}
              onChange={(event) => setSelectedVideoId(event.target.value)}
              className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            >
              {videos.map((video) => (
                <option key={video.id} value={video.id}>
                  {video.title}
                </option>
              ))}
              <option value="custom">＋ 自定义链接（顺手入库）</option>
            </select>
            <p className="text-xs text-muted-foreground">
              视频库可在「视频库」页统一管理；重复发布同一视频即可做标注一致性比对。
            </p>
          </div>

          {isCustomVideo ? (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="videoTitle">视频标题（选填）</Label>
                <Input
                  id="videoTitle"
                  name="videoTitle"
                  placeholder="留空则按链接自动命名"
                />
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
                  发布时会自动收入视频库，之后可复用；视频不占用数据库存储。
                </p>
              </div>
            </>
          ) : null}
        </>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            <Label htmlFor="batchTitle">默认任务名前缀（选填）</Label>
            <Input
              id="batchTitle"
              name="title"
              placeholder="例如：Push-T 推方块动作切分"
            />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="batchUrls">批量视频列表（每行一个）</Label>
              <button
                type="button"
                onClick={() => setBatchUrls(SAMPLE_BATCH_TEXT)}
                className="text-xs text-primary hover:underline"
              >
                填入示例
              </button>
            </div>
            <textarea
              id="batchUrls"
              name="batchUrls"
              rows={5}
              value={batchUrls}
              onChange={(event) => setBatchUrls(event.target.value)}
              placeholder={
                '支持每行直接填 URL，或按“任务名 | 视频URL”格式：\nPush-T #01 | https://…/file-000.mp4\nhttps://…/file-001.mp4'
              }
              required
              className="w-full rounded-lg border border-input bg-transparent p-2.5 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            />
            <p className="text-xs text-muted-foreground">
              适用于 LeRobot 数据集按 chunk 批量下发标注任务（单次最多 50 条）；链接会自动收入视频库。
            </p>
          </div>
        </>
      )}

      <div className="flex flex-col gap-2 border-t pt-3">
        <div className="flex items-center justify-between">
          <Label htmlFor="guideline">标注指引（展示给标注员）</Label>
          <button
            type="button"
            onClick={() =>
              setGuideline((current) => current || SAMPLE_GUIDELINE)
            }
            className="text-xs text-primary hover:underline"
          >
            填入示例
          </button>
        </div>
        <textarea
          id="guideline"
          name="guideline"
          rows={3}
          value={guideline}
          onChange={(event) => setGuideline(event.target.value)}
          placeholder="写清“什么算有用片段”：例如只标完整的抓取→放置周期，排除复位与空闲段，单段不少于 2 秒……"
          className="w-full rounded-lg border border-input bg-transparent p-2.5 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        />
        <p className="text-xs text-muted-foreground">
          指引会常驻显示在标注工作台顶部，是双人比对一致性的前提。
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="labels">快捷标签（选填，逗号分隔）</Label>
          <button
            type="button"
            onClick={() => setLabels((current) => current || SAMPLE_LABELS)}
            className="text-xs text-primary hover:underline"
          >
            填入示例
          </button>
        </div>
        <Input
          id="labels"
          name="labels"
          value={labels}
          onChange={(event) => setLabels(event.target.value)}
          placeholder="抓取物体, 移动机械臂, 放置物体…（留空则用默认标签）"
        />
        <p className="text-xs text-muted-foreground">
          标注员为片段备注打标时的一键选项，按任务定制；最多 20 个。
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
        {mode === 'batch' ? (
          <Layers data-icon="inline-start" />
        ) : (
          <Plus data-icon="inline-start" />
        )}
        {pending
          ? '发布中…'
          : mode === 'batch'
            ? '批量发布任务'
            : '发布任务'}
      </Button>
    </form>
  )
}
