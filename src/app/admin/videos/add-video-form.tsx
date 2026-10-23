'use client'

import { useActionState, useState } from 'react'
import { Plus } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  createVideoAction,
  type CreateVideoState,
} from './actions'

const SAMPLE_PRESETS = [
  {
    label: '填入 Push-T 示例',
    title: 'Push-T 推方块 · Episode 1',
    url: 'https://huggingface.co/datasets/lerobot/pusht/resolve/main/videos/observation.image/chunk-000/file-000.mp4',
    dataset: 'lerobot/pusht',
    episode: 'chunk-000/file-000',
  },
  {
    label: '填入 ALOHA 示例',
    title: 'ALOHA 双臂做咖啡 · Episode 1',
    url: 'https://huggingface.co/datasets/lerobot/aloha_static_coffee/resolve/main/videos/observation.images.cam_high/chunk-000/file-000.mp4',
    dataset: 'lerobot/aloha_static_coffee',
    episode: 'chunk-000/file-000',
  },
]

const initialState: CreateVideoState = {}

export function AddVideoForm() {
  const [state, formAction, pending] = useActionState(
    createVideoAction,
    initialState
  )
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [dataset, setDataset] = useState('')
  const [episode, setEpisode] = useState('')

  function applyPreset(preset: (typeof SAMPLE_PRESETS)[number]) {
    setTitle(preset.title)
    setUrl(preset.url)
    setDataset(preset.dataset)
    setEpisode(preset.episode)
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="videoTitle">视频标题</Label>
        <Input
          id="videoTitle"
          name="title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="例如：ALOHA 双臂做咖啡 · Episode 1（留空则按链接自动命名）"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="videoUrl">视频链接</Label>
        <Input
          id="videoUrl"
          name="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://…/video.mp4"
          required
        />
        <p className="text-xs text-muted-foreground">
          直接使用可访问的 MP4 链接；视频时长会在标注员首次打开时自动回填。
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="videoDataset">数据集（选填）</Label>
          <Input
            id="videoDataset"
            name="dataset"
            value={dataset}
            onChange={(event) => setDataset(event.target.value)}
            placeholder="lerobot/pusht"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="videoEpisode">Episode（选填）</Label>
          <Input
            id="videoEpisode"
            name="episode"
            value={episode}
            onChange={(event) => setEpisode(event.target.value)}
            placeholder="chunk-000/file-000"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {SAMPLE_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => applyPreset(preset)}
            className="text-xs text-primary hover:underline"
          >
            {preset.label}
          </button>
        ))}
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

      <Button type="submit" disabled={pending}>
        <Plus data-icon="inline-start" />
        {pending ? '添加中…' : '添加到视频库'}
      </Button>
    </form>
  )
}
