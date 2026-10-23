'use server'

import { revalidatePath } from 'next/cache'
import { requireProfile } from '@/lib/auth'
import { translateDbError } from '@/lib/errors'
import { createClient } from '@/lib/supabase/server'
import { deriveVideoTitle } from '@/lib/videos'
import type { ActionResult } from '@/lib/types'

export type CreateVideoState = { error?: string; success?: string }

const URL_REGEX = /^https?:\/\/\S+$/i

export async function createVideoAction(
  _prev: CreateVideoState,
  formData: FormData
): Promise<CreateVideoState> {
  const profile = await requireProfile('admin')

  const url = String(formData.get('url') ?? '').trim()
  const title = String(formData.get('title') ?? '').trim()
  const dataset = String(formData.get('dataset') ?? '').trim()
  const episode = String(formData.get('episode') ?? '').trim()

  if (!url) {
    return { error: '视频链接不能为空' }
  }
  if (!URL_REGEX.test(url)) {
    return { error: '视频链接需要以 http:// 或 https:// 开头' }
  }

  const supabase = await createClient()

  const { data: existing } = await supabase
    .from('videos')
    .select('id')
    .eq('url', url)
    .maybeSingle()

  if (existing) {
    return { error: '该视频链接已在视频库中，无需重复添加' }
  }

  const { error } = await supabase.from('videos').insert({
    title: title || deriveVideoTitle(url),
    url,
    dataset: dataset || null,
    episode: episode || null,
    created_by: profile.id,
  })

  if (error) {
    return {
      error: error.message.includes('row-level security')
        ? '没有添加权限，请确认当前账号是管理员'
        : '添加失败，请稍后重试',
    }
  }

  revalidatePath('/admin/videos')
  revalidatePath('/admin')
  return { success: `已添加视频「${title || deriveVideoTitle(url)}」` }
}

export async function deleteVideoAction(videoId: string): Promise<ActionResult> {
  await requireProfile('admin')
  const supabase = await createClient()

  const { error } = await supabase.from('videos').delete().eq('id', videoId)

  if (error) {
    // 23503: 仍有任务引用该视频，外键约束阻止删除
    if (error.code === '23503' || error.message.includes('violates foreign key')) {
      return {
        ok: false,
        error: '该视频仍被任务引用，无法删除；请先处理引用它的任务。',
      }
    }
    return { ok: false, error: translateDbError(error.message) }
  }

  revalidatePath('/admin/videos')
  revalidatePath('/admin')
  return { ok: true }
}
