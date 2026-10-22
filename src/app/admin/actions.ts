'use server'

import { revalidatePath } from 'next/cache'
import { requireProfile } from '@/lib/auth'
import { translateDbError } from '@/lib/errors'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import type { ActionResult } from '@/lib/types'

export type CreateTaskState = { error?: string; success?: string }

const URL_REGEX = /^https?:\/\/\S+$/i

export async function createTaskAction(
  _prev: CreateTaskState,
  formData: FormData
): Promise<CreateTaskState> {
  const profile = await requireProfile('admin')

  const mode = String(formData.get('mode') ?? 'single')
  const tenantId = String(formData.get('tenantId') ?? '').trim()

  if (!tenantId) {
    return { error: '请选择所属租户' }
  }

  const rowsToInsert: Array<{
    title: string
    video_url: string
    tenant_id: string
    created_by: string
  }> = []

  if (mode === 'batch') {
    const titlePrefix = String(formData.get('title') ?? '').trim()
    const batchText = String(formData.get('batchUrls') ?? '').trim()
    const lines = batchText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)

    if (lines.length === 0) {
      return { error: '请至少输入一行视频链接' }
    }
    if (lines.length > 50) {
      return { error: '单次批量发布最多支持 50 个任务' }
    }

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      let itemTitle = ''
      let itemUrl = ''

      if (line.includes('|')) {
        const [left, ...rest] = line.split('|')
        itemTitle = left.trim()
        itemUrl = rest.join('|').trim()
      } else {
        itemUrl = line
        itemTitle = titlePrefix
          ? `${titlePrefix} #${String(i + 1).padStart(2, '0')}`
          : `视频标注任务 #${String(i + 1).padStart(2, '0')}`
      }

      if (!itemTitle) {
        return { error: `第 ${i + 1} 行缺少任务名称` }
      }
      if (!URL_REGEX.test(itemUrl)) {
        return {
          error: `第 ${i + 1} 行视频链接不合法，需以 http:// 或 https:// 开头`,
        }
      }

      rowsToInsert.push({
        title: itemTitle,
        video_url: itemUrl,
        tenant_id: tenantId,
        created_by: profile.id,
      })
    }
  } else {
    const title = String(formData.get('title') ?? '').trim()
    const videoUrl = String(formData.get('videoUrl') ?? '').trim()

    if (!title || !videoUrl) {
      return { error: '任务名称、视频链接和租户都不能为空' }
    }

    if (!URL_REGEX.test(videoUrl)) {
      return { error: '视频链接需要以 http:// 或 https:// 开头' }
    }

    rowsToInsert.push({
      title,
      video_url: videoUrl,
      tenant_id: tenantId,
      created_by: profile.id,
    })
  }

  try {
    const supabase = await createClient()
    const { error } = await supabase.from('tasks').insert(rowsToInsert)

    if (error) {
      return {
        error: error.message.includes('row-level security')
          ? '没有发布权限，请确认当前账号是管理员'
          : '发布失败，请稍后重试',
      }
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : '发布失败，请稍后重试',
    }
  }

  revalidatePath('/admin')
  revalidatePath('/tasks')
  return {
    success:
      rowsToInsert.length > 1
        ? `已批量发布 ${rowsToInsert.length} 个任务，标注员可以立即看到并领取。`
        : '任务已发布，标注员可以看到并领取。',
  }
}

export async function reopenTaskAction(taskId: string): Promise<ActionResult> {
  await requireProfile('admin')
  const supabase = await createClient()

  const { error } = await supabase.rpc('reopen_task', {
    p_task_id: taskId,
  })

  if (error) {
    const service = createServiceClient()
    if (
      service &&
      (error.message.includes('reopen_task') ||
        error.message.includes('function') ||
        error.code === 'PGRST202')
    ) {
      const { data: updated, error: updateErr } = await service
        .from('tasks')
        .update({ status: 'claimed', submitted_at: null })
        .eq('id', taskId)
        .eq('status', 'submitted')
        .select('id')

      if (updateErr || !updated || updated.length === 0) {
        return { ok: false, error: '只有已提交的任务才能打回重标' }
      }
    } else {
      return { ok: false, error: translateDbError(error.message) }
    }
  }

  revalidatePath('/admin')
  revalidatePath(`/admin/tasks/${taskId}`)
  revalidatePath('/admin/stats')
  revalidatePath('/tasks')
  revalidatePath(`/tasks/${taskId}`)
  return { ok: true }
}

export async function adminUnclaimTaskAction(
  taskId: string
): Promise<ActionResult> {
  await requireProfile('admin')
  const supabase = await createClient()

  const { error } = await supabase.rpc('unclaim_task', {
    p_task_id: taskId,
  })

  if (error) {
    const service = createServiceClient()
    if (
      service &&
      (error.message.includes('unclaim_task') ||
        error.message.includes('function') ||
        error.code === 'PGRST202')
    ) {
      await service.from('segments').delete().eq('task_id', taskId)
      const { data: updated, error: updateErr } = await service
        .from('tasks')
        .update({ status: 'unassigned', assignee_id: null, submitted_at: null })
        .eq('id', taskId)
        .eq('status', 'claimed')
        .select('id')

      if (updateErr || !updated || updated.length === 0) {
        return { ok: false, error: '只有标注中的任务才能回收' }
      }
    } else {
      return { ok: false, error: translateDbError(error.message) }
    }
  }

  revalidatePath('/admin')
  revalidatePath(`/admin/tasks/${taskId}`)
  revalidatePath('/tasks')
  revalidatePath(`/tasks/${taskId}`)
  return { ok: true }
}
