'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { requireProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { translateDbError } from '@/lib/errors'

export async function claimTaskAction(formData: FormData) {
  await requireProfile('annotator')

  const taskId = String(formData.get('taskId') ?? '')
  if (!taskId) {
    redirect('/tasks?error=' + encodeURIComponent('缺少任务 ID'))
  }

  const supabase = await createClient()
  const { error } = await supabase.rpc('claim_task', { p_task_id: taskId })

  if (error) {
    redirect('/tasks?error=' + encodeURIComponent(translateDbError(error.message)))
  }

  revalidatePath('/tasks')
  redirect(`/tasks/${taskId}`)
}
