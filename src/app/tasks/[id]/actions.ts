'use server'

import { revalidatePath } from 'next/cache'
import { requireProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { translateDbError } from '@/lib/errors'
import type { ActionResult, SegmentInput } from '@/lib/types'

type SegmentRow = { start_ms: number; end_ms: number; note: string | null }

function toRows(segments: SegmentInput[]): SegmentRow[] | null {
  if (!Array.isArray(segments)) {
    return null
  }

  const rows: SegmentRow[] = []
  for (const segment of segments) {
    const start = Math.round(Number(segment?.startMs))
    const end = Math.round(Number(segment?.endMs))

    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      return null
    }

    const note = typeof segment?.note === 'string' ? segment.note.trim() : ''
    if (note.length > 500) {
      return null
    }

    rows.push({ start_ms: start, end_ms: end, note: note || null })
  }

  rows.sort((a, b) => a.start_ms - b.start_ms)
  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i].start_ms < rows[i - 1].end_ms) {
      return null
    }
  }

  return rows
}

export async function saveDraftAction(
  taskId: string,
  segments: SegmentInput[]
): Promise<ActionResult> {
  await requireProfile('annotator')

  const rows = toRows(segments)
  if (!rows) {
    return { ok: false, error: '时间段或备注格式不正确（备注不超过 500 字）' }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('save_task_segments', {
    p_task_id: taskId,
    p_segments: rows,
  })

  if (error) {
    return { ok: false, error: translateDbError(error.message) }
  }

  revalidatePath(`/tasks/${taskId}`)
  return { ok: true }
}

export async function submitTaskAction(
  taskId: string,
  segments: SegmentInput[]
): Promise<ActionResult> {
  await requireProfile('annotator')

  const rows = toRows(segments)
  if (!rows) {
    return { ok: false, error: '时间段或备注格式不正确（备注不超过 500 字）' }
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('submit_task', {
    p_task_id: taskId,
    p_segments: rows,
  })

  if (error) {
    return { ok: false, error: translateDbError(error.message) }
  }

  revalidatePath('/tasks')
  revalidatePath(`/tasks/${taskId}`)
  return { ok: true }
}
