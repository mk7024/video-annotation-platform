'use server'

import { revalidatePath } from 'next/cache'
import { requireProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

export type CreateTaskState = { error?: string; success?: string }

export async function createTaskAction(
  _prev: CreateTaskState,
  formData: FormData
): Promise<CreateTaskState> {
  const profile = await requireProfile('admin')

  const title = String(formData.get('title') ?? '').trim()
  const videoUrl = String(formData.get('videoUrl') ?? '').trim()
  const tenantId = String(formData.get('tenantId') ?? '').trim()

  if (!title || !videoUrl || !tenantId) {
    return { error: '任务名称、视频链接和租户都不能为空' }
  }

  if (!/^https?:\/\/\S+$/i.test(videoUrl)) {
    return { error: '视频链接需要以 http:// 或 https:// 开头' }
  }

  try {
    const supabase = await createClient()
    const { error } = await supabase.from('tasks').insert({
      title,
      video_url: videoUrl,
      tenant_id: tenantId,
      created_by: profile.id,
    })

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
  return { success: '任务已发布，标注员可以看到并领取。' }
}
