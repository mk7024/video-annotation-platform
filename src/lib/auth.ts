import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { relationField } from '@/lib/relations'
import type { Profile, Role } from '@/lib/types'

export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return null
  }

  const { data } = await supabase
    .from('profiles')
    .select('id, role, tenant_id, display_name, tenant:tenants(name)')
    .eq('id', user.id)
    .maybeSingle()

  if (!data) {
    return null
  }

  return {
    id: data.id,
    role: data.role as Role,
    tenant_id: data.tenant_id,
    display_name: data.display_name,
    tenant_name: relationField(data.tenant, 'name'),
  }
}

export async function requireProfile(role?: Role): Promise<Profile> {
  const profile = await getCurrentProfile()

  if (!profile) {
    redirect('/login')
  }

  if (role && profile.role !== role) {
    redirect(profile.role === 'admin' ? '/admin' : '/tasks')
  }

  return profile
}
