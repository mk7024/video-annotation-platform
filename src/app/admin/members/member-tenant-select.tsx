'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRightLeft } from 'lucide-react'
import { moveMemberTenantAction } from './actions'
import { Button } from '@/components/ui/button'

type TenantOption = { id: string; name: string }

export function MemberTenantSelect({
  profileId,
  currentTenantId,
  tenants,
}: {
  profileId: string
  currentTenantId: string | null
  tenants: TenantOption[]
}) {
  const router = useRouter()
  const [tenantId, setTenantId] = useState(currentTenantId ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const options = currentTenantId
    ? tenants
    : [{ id: '', name: '（未分配）' }, ...tenants]

  function handleMove() {
    if (!tenantId || tenantId === currentTenantId) {
      return
    }
    const target = tenants.find((tenant) => tenant.id === tenantId)
    const confirmed = window.confirm(
      `确认把该标注员移动到「${target?.name ?? tenantId}」吗？\n移动后其任务可见性随新租户生效，已领取的任务不受影响。`
    )
    if (!confirmed) {
      return
    }

    setError(null)
    startTransition(async () => {
      const result = await moveMemberTenantAction(profileId, tenantId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex items-center gap-1">
        <select
          value={tenantId}
          onChange={(event) => setTenantId(event.target.value)}
          aria-label="调整所属租户"
          className="h-7 w-36 rounded-lg border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        >
          {options.map((tenant) => (
            <option key={tenant.id} value={tenant.id}>
              {tenant.name}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="移动到所选租户"
          title="移动到所选租户"
          disabled={isPending || !tenantId || tenantId === currentTenantId}
          onClick={handleMove}
        >
          <ArrowRightLeft />
        </Button>
      </div>
      {error ? (
        <span className="max-w-44 text-[11px] text-destructive">{error}</span>
      ) : null}
    </div>
  )
}
