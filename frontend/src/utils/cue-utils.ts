import type { Cue, CueAckState, OperatorRole } from '../types'

type CanEditCueInput = {
  isOwner: boolean
  activeRole: OperatorRole | null
  cueRole: OperatorRole
}

export const canEditCue = ({ isOwner, activeRole, cueRole }: CanEditCueInput) => {
  if (isOwner) return true
  if (!activeRole) return false
  return activeRole === cueRole
}

export const reorderCueIds = (cues: Cue[], fromIndex: number, toIndex: number) => {
  if (fromIndex < 0 || fromIndex >= cues.length) return cues.map((cue) => cue.id)
  const ordered = [...cues]
  const [moved] = ordered.splice(fromIndex, 1)
  if (!moved) return cues.map((cue) => cue.id)
  const clamped = Math.max(0, Math.min(toIndex, ordered.length))
  ordered.splice(clamped, 0, moved)
  return ordered.map((cue) => cue.id)
}

export const insertCueId = (cueIds: string[], cueId: string, targetIndex: number) => {
  const filtered = cueIds.filter((id) => id !== cueId)
  const clamped = Math.max(0, Math.min(targetIndex, filtered.length))
  filtered.splice(clamped, 0, cueId)
  return filtered
}

export const buildAckPatch = (
  ackState: CueAckState,
  userId?: string | null,
  now: number = Date.now(),
): Record<string, unknown> => {
  if (ackState === 'pending') {
    return { ackState: 'pending', ackAt: null, ackBy: null }
  }
  return { ackState, ackAt: now, ackBy: userId ?? null }
}

export const buildEditedByRolePatch = (role: OperatorRole | null) =>
  role ? { editedByRole: role } : { editedByRole: null }
