export type Role = 'admin' | 'annotator'

export type TaskStatus = 'unassigned' | 'claimed' | 'submitted'

export type Profile = {
  id: string
  role: Role
  tenant_id: string | null
  display_name: string
  tenant_name: string | null
}

export type VideoRecord = {
  id: string
  title: string
  url: string
  duration_ms: number | null
  dataset: string | null
  episode: string | null
}

export type SegmentInput = {
  startMs: number
  endMs: number
  note?: string | null
}

export type SegmentRecord = {
  id: string
  start_ms: number
  end_ms: number
  note: string | null
}

export type ActionResult = { ok: true } | { ok: false; error: string }
