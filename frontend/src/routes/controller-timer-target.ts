export const resolveControllerTimerTargetId = ({
  shortcutScope,
  selectedTimerId,
  activeTimerId,
  timers,
}: {
  shortcutScope: 'controls' | 'rundown'
  selectedTimerId: string | null
  activeTimerId: string | null
  timers: Array<{ id: string }>
}): string | null => {
  const timerIds = new Set(timers.map((timer) => timer.id))
  if (shortcutScope === 'rundown' && selectedTimerId && timerIds.has(selectedTimerId)) {
    return selectedTimerId
  }
  if (activeTimerId && timerIds.has(activeTimerId)) {
    return activeTimerId
  }
  return timers[0]?.id ?? null
}
