'use server'

import { revalidatePath } from 'next/cache'
import { requireProfile } from '@/lib/auth'
import { translateDbError } from '@/lib/errors'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { deriveVideoTitle, parseLabelInput } from '@/lib/videos'
import type { ActionResult } from '@/lib/types'

export type CreateTaskState = { error?: string; success?: string }

const URL_REGEX = /^https?:\/\/\S+$/i

type AdminClient = Awaited<ReturnType<typeof createClient>>

// 按 URL 入库并返回视频 ID：并发/重复场景下唯一键兜底，先插后查
async function ensureVideoByUrl(
  supabase: AdminClient,
  url: string,
  title: string,
  createdById: string
): Promise<string> {
  const { data: inserted } = await supabase
    .from('videos')
    .upsert(
      { title, url, created_by: createdById },
      { onConflict: 'url', ignoreDuplicates: true }
    )
    .select('id')
    .maybeSingle()

  if (inserted?.id) {
    return inserted.id
  }

  const { data: existing } = await supabase
    .from('videos')
    .select('id')
    .eq('url', url)
    .maybeSingle()

  if (existing?.id) {
    return existing.id
  }

  throw new Error('VIDEO_CREATE_FAILED')
}

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

  const guidelineRaw = String(formData.get('guideline') ?? '').trim()
  if (guidelineRaw.length > 2000) {
    return { error: '标注指引不能超过 2000 字' }
  }
  const guideline = guidelineRaw || null

  const parsedLabels = parseLabelInput(String(formData.get('labels') ?? ''))
  if ('error' in parsedLabels) {
    return { error: parsedLabels.error }
  }
  const labels = parsedLabels.labels

  const rowsToInsert: Array<{
    title: string
    video_id: string
    tenant_id: string
    created_by: string
    guideline: string | null
    labels: string[]
  }> = []

  try {
    const supabase = await createClient()

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

      const videoIdByUrl = new Map<string, string>()

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

        let videoId = videoIdByUrl.get(itemUrl)
        if (!videoId) {
          videoId = await ensureVideoByUrl(
            supabase,
            itemUrl,
            deriveVideoTitle(itemUrl),
            profile.id
          )
          videoIdByUrl.set(itemUrl, videoId)
        }

        rowsToInsert.push({
          title: itemTitle,
          video_id: videoId,
          tenant_id: tenantId,
          created_by: profile.id,
          guideline,
          labels,
        })
      }
    } else {
      const title = String(formData.get('title') ?? '').trim()
      const selectedVideoId = String(formData.get('videoId') ?? '').trim()
      const videoUrl = String(formData.get('videoUrl') ?? '').trim()
      const videoTitle = String(formData.get('videoTitle') ?? '').trim()

      if (!title) {
        return { error: '任务名称不能为空' }
      }

      let resolvedVideoId: string
      if (selectedVideoId) {
        const { data: video } = await supabase
          .from('videos')
          .select('id')
          .eq('id', selectedVideoId)
          .maybeSingle()

        if (!video) {
          return { error: '所选视频不存在，请刷新页面后重试' }
        }
        resolvedVideoId = video.id
      } else {
        if (!videoUrl) {
          return { error: '请从视频库选择视频，或填写自定义视频链接' }
        }
        if (!URL_REGEX.test(videoUrl)) {
          return { error: '视频链接需要以 http:// 或 https:// 开头' }
        }
        resolvedVideoId = await ensureVideoByUrl(
          supabase,
          videoUrl,
          videoTitle || deriveVideoTitle(videoUrl),
          profile.id
        )
      }

      rowsToInsert.push({
        title,
        video_id: resolvedVideoId,
        tenant_id: tenantId,
        created_by: profile.id,
        guideline,
        labels,
      })
    }

    const { error } = await supabase.from('tasks').insert(rowsToInsert)

    if (error) {
      return {
        error: error.message.includes('row-level security')
          ? '没有发布权限，请确认当前账号是管理员'
          : '发布失败，请稍后重试',
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'VIDEO_CREATE_FAILED') {
      return { error: '视频入库失败，请稍后重试' }
    }
    return {
      error: error instanceof Error ? error.message : '发布失败，请稍后重试',
    }
  }

  revalidatePath('/admin')
  revalidatePath('/admin/videos')
  revalidatePath('/tasks')
  return {
    success:
      rowsToInsert.length > 1
        ? `已批量发布 ${rowsToInsert.length} 个任务，标注员可以立即看到并领取。`
        : '任务已发布，标注员可以看到并领取。',
  }
}

// 管理员把待领取任务直接指派给同租户标注员
export async function assignTaskAction(
  taskId: string,
  profileId: string
): Promise<ActionResult> {
  await requireProfile('admin')
  const supabase = await createClient()

  const { error } = await supabase.rpc('assign_task', {
    p_task_id: taskId,
    p_profile_id: profileId,
  })

  if (error) {
    if (error.code === 'PGRST202') {
      return { ok: false, error: '请先在数据库执行 0005_tenant_admin.sql 迁移' }
    }
    return { ok: false, error: translateDbError(error.message) }
  }

  revalidatePath('/admin')
  revalidatePath(`/admin/tasks/${taskId}`)
  revalidatePath('/tasks')
  return { ok: true }
}

export async function reopenTaskAction(
  taskId: string,
  note: string
): Promise<ActionResult> {
  await requireProfile('admin')

  const trimmedNote = note.trim()
  if (!trimmedNote) {
    return { ok: false, error: '请填写打回原因，标注员需要知道哪里有问题' }
  }
  if (trimmedNote.length > 1000) {
    return { ok: false, error: '打回原因不能超过 1000 字' }
  }

  const supabase = await createClient()

  const { error } = await supabase.rpc('reopen_task', {
    p_task_id: taskId,
    p_note: trimmedNote,
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
        .update({
          status: 'claimed',
          submitted_at: null,
          reopen_note: trimmedNote,
        })
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
