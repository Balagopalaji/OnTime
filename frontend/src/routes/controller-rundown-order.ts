import type { Section, Segment, Timer } from '../types'

type RundownOrderArgs = {
  timers: Timer[]
  sections: Section[]
  segments: Segment[]
}

const byOrder = <T extends { order: number }>(left: T, right: T) => left.order - right.order

const byTimerOrder = (left: Timer, right: Timer) =>
  (left.segmentOrder ?? left.order) - (right.segmentOrder ?? right.order)

export const buildControllerRundownOrder = ({
  timers,
  sections,
  segments,
}: RundownOrderArgs): Timer[] => {
  const orderedSections = [...sections].sort(byOrder)
  const orderedSegments = [...segments].sort(byOrder)

  const segmentsBySection = new Map<string, Segment[]>()
  orderedSegments.forEach((segment) => {
    const key = segment.sectionId ?? '__none__'
    const list = segmentsBySection.get(key) ?? []
    list.push(segment)
    segmentsBySection.set(key, list)
  })

  const timersBySegment = new Map<string, Timer[]>()
  const sectionLevelTimers = new Map<string, Timer[]>()
  const unassignedTimers: Timer[] = []

  timers.forEach((timer) => {
    if (timer.segmentId) {
      const list = timersBySegment.get(timer.segmentId) ?? []
      list.push(timer)
      timersBySegment.set(timer.segmentId, list)
      return
    }

    if (timer.sectionId) {
      const list = sectionLevelTimers.get(timer.sectionId) ?? []
      list.push(timer)
      sectionLevelTimers.set(timer.sectionId, list)
      return
    }

    unassignedTimers.push(timer)
  })

  const ordered: Timer[] = []
  const seen = new Set<string>()
  const pushTimers = (list: Timer[] | undefined) => {
    if (!list?.length) return
    list
      .slice()
      .sort(byTimerOrder)
      .forEach((timer) => {
        if (seen.has(timer.id)) return
        seen.add(timer.id)
        ordered.push(timer)
      })
  }

  orderedSections.forEach((section) => {
    const sectionSegments = segmentsBySection.get(section.id) ?? []
    sectionSegments.forEach((segment) => {
      pushTimers(timersBySegment.get(segment.id))
    })
    pushTimers(sectionLevelTimers.get(section.id))
  })

  const unsectionedSegments = segmentsBySection.get('__none__') ?? []
  unsectionedSegments.forEach((segment) => {
    pushTimers(timersBySegment.get(segment.id))
  })
  pushTimers(unassignedTimers)

  if (ordered.length === timers.length) {
    return ordered
  }

  timers
    .slice()
    .sort(byTimerOrder)
    .forEach((timer) => {
      if (seen.has(timer.id)) return
      seen.add(timer.id)
      ordered.push(timer)
    })

  return ordered
}
