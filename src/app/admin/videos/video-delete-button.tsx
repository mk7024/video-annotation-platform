'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { deleteVideoAction } from './actions'
import { Button } from '@/components/ui/button'

export function VideoDeleteButton({ videoId }: { videoId: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleDelete() {
    const confirmed = window.confirm(
      '确认从视频库删除该视频吗？\n仍被任务引用的视频无法删除。'
    )
    if (!confirmed) {
      return
    }

    setError(null)
    startTransition(async () => {
      const result = await deleteVideoAction(videoId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="删除该视频"
        title="删除该视频（仍被任务引用时会被拒绝）"
        disabled={isPending}
        onClick={handleDelete}
      >
        <Trash2 />
      </Button>
      {error ? (
        <span className="max-w-48 text-right text-[11px] text-destructive">
          {error}
        </span>
      ) : null}
    </div>
  )
}
