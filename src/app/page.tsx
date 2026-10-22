import { redirect } from 'next/navigation'
import { requireProfile } from '@/lib/auth'

export default async function HomePage() {
  const profile = await requireProfile()
  redirect(profile.role === 'admin' ? '/admin' : '/tasks')
}
