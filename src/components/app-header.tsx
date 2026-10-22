import Link from 'next/link'
import { LogOut } from 'lucide-react'
import { logoutAction } from '@/app/actions'
import { Button } from '@/components/ui/button'
import type { Profile } from '@/lib/types'

export function AppHeader({ profile }: { profile: Profile }) {
  const links =
    profile.role === 'admin'
      ? [
          { href: '/admin', label: '任务管理' },
          { href: '/admin/stats', label: '工作量统计' },
        ]
      : [{ href: '/tasks', label: '我的任务' }]

  const home = profile.role === 'admin' ? '/admin' : '/tasks'

  return (
    <header className="sticky top-0 z-20 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4">
        <div className="flex min-w-0 items-center gap-5">
          <Link href={home} className="shrink-0 font-semibold tracking-tight">
            片段标注平台
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex min-w-0 items-center gap-3">
          <span className="hidden truncate text-sm text-muted-foreground sm:inline">
            {profile.display_name}
            {profile.tenant_name ? ` · ${profile.tenant_name}` : ' · 平台管理员'}
          </span>
          <form action={logoutAction}>
            <Button variant="ghost" size="sm" type="submit">
              <LogOut data-icon="inline-start" />
              退出
            </Button>
          </form>
        </div>
      </div>
    </header>
  )
}
