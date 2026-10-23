'use server'

import { revalidatePath } from 'next/cache'
import { requireProfile } from '@/lib/auth'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { translateDbError } from '@/lib/errors'
import type { ActionResult, SegmentInput } from '@/lib/types'

type SegmentRow = { start_ms: number; end_ms: number; note: string | null }

const MAX_REASONABLE_VIDEO_MS = 12 * 3600 * 1000 // 12 小时安全上限，防止恶意刷工时

function toRows(
  segments: SegmentInput[],
  videoDurationMs?: number
): { rows: SegmentRow[] } | { error: string } {
  if (!Array.isArray(segments)) {
    return { error: '时间段数据格式不正确' }
  }

  const limitMs =
    typeof videoDurationMs === 'number' &&
    Number.isFinite(videoDurationMs) &&
    videoDurationMs > 0
      ? Math.round(videoDurationMs) + 500
      : MAX_REASONABLE_VIDEO_MS

  const rows: SegmentRow[] = []
  for (const segment of segments) {
    const start = Math.round(Number(segment?.startMs))
    const end = Math.round(Number(segment?.endMs))

    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start
    ) {
      return { error: '时间段起点和终点不合法（终点必须晚于起点）' }
    }

    if (end - start < 100) {
      return { error: '片段长度至少需要 0.1 秒' }
    }

    if (end > limitMs || end > MAX_REASONABLE_VIDEO_MS) {
      return { error: '时间段终点超出了视频总时长上限' }
    }

    const note = typeof segment?.note === 'string' ? segment.note.trim() : ''
    if (note.length > 500) {
      return { error: '片段备注不能超过 500 字' }
    }

    rows.push({ start_ms: start, end_ms: end, note: note || null })
  }

  rows.sort((a, b) => a.start_ms - b.start_ms)
  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i].start_ms < rows[i - 1].end_ms) {
      return { error: '时间段之间不能重叠' }
    }
  }

  return { rows }
}

export async function saveDraftAction(
  taskId: string,
  segments: SegmentInput[],
  videoDurationMs?: number
): Promise<ActionResult> {
  await requireProfile('annotator')

  const parsed = toRows(segments, videoDurationMs)
  if ('error' in parsed) {
    return { ok: false, error: parsed.error }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('save_task_segments', {
    p_task_id: taskId,
    p_segments: parsed.rows,
  })

  if (error) {
    return { ok: false, error: translateDbError(error.message) }
  }

  revalidatePath(`/tasks/${taskId}`)
  return { ok: true }
}

export async function submitTaskAction(
  taskId: string,
  segments: SegmentInput[],
  videoDurationMs?: number
): Promise<ActionResult> {
  await requireProfile('annotator')

  const parsed = toRows(segments, videoDurationMs)
  if ('error' in parsed) {
    return { ok: false, error: parsed.error }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('submit_task', {
    p_task_id: taskId,
    p_segments: parsed.rows,
  })

  if (error) {
    return { ok: false, error: translateDbError(error.message) }
  }

  revalidatePath('/tasks')
  revalidatePath(`/tasks/${taskId}`)
  revalidatePath('/admin')
  revalidatePath('/admin/stats')
  return { ok: true }
}

export async function reportVideoDurationAction(
  videoId: string,
  durationMs: number
): Promise<ActionResult> {
  await requireProfile()

  const rounded = Math.round(durationMs)
  if (!Number.isFinite(rounded) || rounded <= 0) {
    return { ok: false, error: '视频时长数据不合法' }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('report_video_duration', {
    p_video_id: videoId,
    p_duration_ms: rounded,
  })

  if (error) {
    return { ok: false, error: translateDbError(error.message) }
  }
  return { ok: true }
}

export async function unclaimTaskAction(taskId: string): Promise<ActionResult> {
  const profile = await requireProfile('annotator')
  const supabase = await createClient()

  const { error } = await supabase.rpc('unclaim_task', {
    p_task_id: taskId,
  })

  if (error) {
    // 兼容尚未在 Supabase SQL Editor 执行 0003 迁移脚本的本地开发环境
    const service = createServiceClient()
    if (
      service &&
      (error.message.includes('unclaim_task') ||
        error.message.includes('function') ||
        error.code === 'PGRST202')
    ) {
      const { data: task } = await service
        .from('tasks')
        .select('id, status, assignee_id, tenant_id')
        .eq('id', taskId)
        .maybeSingle()

      if (
        !task ||
        task.status !== 'claimed' ||
        task.assignee_id !== profile.id ||
        task.tenant_id !== profile.tenant_id
      ) {
        return { ok: false, error: '任务状态已变化，无法释放' }
      }

      await service.from('segments').delete().eq('task_id', taskId)
      const { error: updateErr } = await service
        .from('tasks')
        .update({ status: 'unassigned', assignee_id: null, submitted_at: null })
        .eq('id', taskId)
        .eq('status', 'claimed')

      if (updateErr) {
        return { ok: false, error: '释放任务失败，请稍后重试' }
      }
    } else {
      return { ok: false, error: translateDbError(error.message) }
    }
  }

  revalidatePath('/tasks')
  revalidatePath(`/tasks/${taskId}`)
  revalidatePath('/admin')
  return { ok: true }
}
