/**
 * Sidecar share orchestration (Deep Plan lifecycle table): credential load or
 * system-browser approval, session create/resume, viewer link, and the publish
 * engine. Pause keeps the cloud session (viewers go stale); end and sign-out
 * are explicit. Only safe statuses and the viewer URL leave this module.
 */
import { randomBytes } from 'node:crypto'
import type { RemoteSnapshotCandidateV1 } from '@ontime/remote-viewer-contracts'
import type { ApprovedDevice, DeviceCredential, createCredentialsClient } from './auth'
import type { CallResult, CloudClient, CloudError } from './cloud-client'
import type { ShareStatus } from './protocol'
import { createPublisher, type PublishResponse, type ResumeResponse } from './publisher'
import { retryDelayMs } from './retry'

export type { ShareStatus }

type Session = { refreshToken: string; sessionId: string | null }
type Credentials = ReturnType<typeof createCredentialsClient>
type Opened = { sessionId: string; epoch: number; viewerUrl: string | null }

const clientRequestId = () => `req_${randomBytes(12).toString('hex')}`
const reasonOf = (error: CloudError) => (typeof error.details.reason === 'string' ? error.details.reason : null)
const isDenied = (error: CloudError) => error.code === 'unauthenticated' || error.code === 'permission-denied'
const isGone = (error: CloudError) => error.code === 'not-found' || reasonOf(error) === 'session-ended'

function parseSession(value: unknown): Session | null {
  if (typeof value !== 'object' || value === null) return null
  const { refreshToken, sessionId } = value as Record<string, unknown>
  if (typeof refreshToken !== 'string' || !refreshToken) return null
  return sessionId === null || typeof sessionId === 'string' ? { refreshToken, sessionId } : null
}

/** Callable result → value, or throw its code (approval callables surface as `approval-failed`). */
export function unwrapCall<T>(result: CallResult<T>): T {
  if (!result.ok) throw new Error(result.error.code)
  return result.data
}

export function toPublishResponse(result: CallResult<{ acceptedSequence: number; publishedAtMs: number }>): PublishResponse {
  if (result.ok) return { ok: true, acceptedSequence: result.data.acceptedSequence, publishedAtMs: result.data.publishedAtMs }
  const { error } = result
  const reason = reasonOf(error)
  if (reason === 'sequence-conflict' && typeof error.details.acceptedSequence === 'number') {
    return { ok: false, reason, acceptedSequence: error.details.acceptedSequence }
  }
  if (reason === 'clock-future' && typeof error.details.serverNowMs === 'number') return { ok: false, reason, serverNowMs: error.details.serverNowMs }
  if (reason === 'sequence-gap' || reason === 'epoch-mismatch' || reason === 'window-expired') return { ok: false, reason }
  if (isGone(error)) return { ok: false, reason: 'session-ended' }
  return { ok: false, reason: isDenied(error) ? 'denied' : 'transient' }
}

export function createShareSession(options: {
  cloud: CloudClient | null
  credentials: Credentials
  approve(): Promise<ApprovedDevice>
  onStatus(status: ShareStatus): void
  onViewerLink(url: string): void
  random?: () => number
}) {
  const random = options.random ?? Math.random
  let run = 0
  let active = false
  let latest: RemoteSnapshotCandidateV1 | null = null
  let credential: DeviceCredential | null = null
  let publisher: ReturnType<typeof createPublisher> | null = null

  const halt = () => {
    run += 1
    active = false
    publisher?.stop()
    publisher = null
  }
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  const sessionOf = () => parseSession(credential?.session)?.sessionId ?? null
  // Every sealed write/clear runs in request order, so a late save can never land after a sign-out clear.
  let writes: Promise<unknown> = Promise.resolve()
  const serial = <T>(op: () => Promise<T>): Promise<T> => {
    const next = writes.then(op)
    writes = next.catch(() => undefined)
    return next
  }

  /** Persist the (possibly rotated) refresh token and the given session ID. */
  const persist = (sessionId: string | null) =>
    serial(async (): Promise<boolean> => {
      const base = credential
      const refreshToken = options.cloud?.refreshToken()
      if (!base || !refreshToken) return false
      const current = parseSession(base.session)
      if (current?.refreshToken === refreshToken && current.sessionId === sessionId) return true
      const next: DeviceCredential = { ...base, session: { refreshToken, sessionId } }
      if (!(await options.credentials.save(next)).ok) return false
      if (credential === base) credential = next
      return true
    })

  /** Load the sealed credential (once per process) and restore its cloud session. */
  async function ensureCredential(cloud: CloudClient): Promise<'ok' | 'not-found' | 'storage-unavailable'> {
    if (credential) return 'ok'
    const loaded = await options.credentials.load()
    if (credential) return 'ok'
    if (!loaded.ok) return loaded.error === 'not-found' ? 'not-found' : 'storage-unavailable'
    const session = parseSession(loaded.credential.session)
    if (!session) return 'storage-unavailable'
    credential = loaded.credential
    cloud.restore(session.refreshToken)
    return 'ok'
  }

  async function signIn(cloud: CloudClient, token: number): Promise<ShareStatus | null> {
    const loaded = await ensureCredential(cloud)
    if (token !== run || loaded === 'ok') return null
    if (loaded === 'storage-unavailable') return loaded
    options.onStatus('awaiting-approval')
    const approved = await options.approve().catch(() => null)
    if (token !== run) return null
    if (!approved || !(await cloud.signInWithCustomToken(approved.customToken)).ok) return 'approval-failed'
    credential = { v: 1, deviceUid: approved.deviceUid, devicePrivateKey: approved.devicePrivateKey, session: { refreshToken: '', sessionId: null } }
    return (await persist(null)) ? null : 'storage-unavailable'
  }

  /** Resume the persisted session (new epoch) or create one; transient failures retry with backoff. */
  async function open(cloud: CloudClient, token: number): Promise<Opened | ShareStatus | null> {
    const previous = parseSession(credential?.session)?.sessionId ?? null
    const requestId = clientRequestId()
    for (let attempt = 1; ; attempt += 1) {
      const result = previous
        ? await cloud.call<Omit<Opened, 'sessionId'>>('resumePresentationSession', { sessionId: previous, clientRequestId: requestId })
        : await cloud.call<Opened>('createPresentationSession', { clientRequestId: requestId })
      if (token !== run) return null
      if (result.ok) return { sessionId: previous ?? (result.data as Opened).sessionId, epoch: result.data.epoch, viewerUrl: result.data.viewerUrl }
      if (isDenied(result.error)) return 'signed-out'
      if (previous && isGone(result.error)) {
        const forgotten = await persist(null)
        if (token !== run) return null
        return forgotten ? open(cloud, token) : 'storage-unavailable'
      }
      options.onStatus('retrying')
      await sleep(retryDelayMs(attempt, random()))
      if (token !== run) return null
    }
  }

  async function start(token: number) {
    const cloud = options.cloud
    if (!cloud) return finish('not-configured')
    options.onStatus('connecting')
    const signedIn = await signIn(cloud, token)
    if (token !== run) return
    if (signedIn) return finish(signedIn)
    const opened = await open(cloud, token)
    if (opened === null) return
    if (typeof opened === 'string') return finish(opened)
    const persisted = await persist(opened.sessionId)
    if (token !== run) return
    if (!persisted) return finish('storage-unavailable')
    let viewerUrl = opened.viewerUrl
    if (viewerUrl === null) {
      const issued = await cloud.call<{ viewerUrl: string }>('issuePresentationViewerLink', { sessionId: opened.sessionId, clientRequestId: clientRequestId() })
      if (token !== run) return
      viewerUrl = issued.ok ? issued.data.viewerUrl : null
    }
    if (viewerUrl) options.onViewerLink(viewerUrl)
    publisher = createPublisher({
      sessionId: opened.sessionId,
      epoch: opened.epoch,
      random,
      send: async (request) => toPublishResponse(await cloud.call('publishPresentationSnapshot', request)),
      resume: async (): Promise<ResumeResponse> => {
        const result = await cloud.call<{ epoch: number }>('resumePresentationSession', { sessionId: opened.sessionId, clientRequestId: clientRequestId() })
        if (result.ok) return { ok: true, epoch: result.data.epoch }
        return { ok: false, reason: isGone(result.error) ? 'session-ended' : isDenied(result.error) ? 'denied' : 'transient' }
      },
      onStatus: (status) => {
        if (token !== run) return
        if (status === 'ended' || status === 'signed-out') return finish(status)
        options.onStatus(status)
      },
    })
    if (latest) publisher.offer(latest)
  }

  function finish(status: ShareStatus) {
    halt()
    if (status === 'ended') void persist(null)
    if (status === 'signed-out') {
      options.cloud?.signOut()
      credential = null
      void serial(() => options.credentials.clear())
    }
    options.onStatus(status)
  }

  return {
    start() {
      if (active) return
      halt()
      active = true
      void start(run)
    },
    offer(candidate: RemoteSnapshotCandidateV1) {
      latest = candidate
      publisher?.offer(candidate)
    },
    /** Stop publishing but keep the cloud session; viewers go stale, then disconnected. */
    pause() {
      halt()
      latest = null
      options.onStatus('paused')
    },
    /** Seal a rotated refresh token (cloud client hook). */
    refreshTokenChanged() {
      void persist(sessionOf())
    },
    /**
     * End the cloud session explicitly; viewers see `ended`. If the end call
     * fails the session is kept (status `paused`) so End can be retried.
     */
    async end() {
      halt()
      latest = null
      const cloud = options.cloud
      if (cloud) await ensureCredential(cloud)
      const sessionId = sessionOf()
      if (cloud && sessionId) {
        const result = await cloud.call('endPresentationSession', { sessionId, clientRequestId: clientRequestId() })
        if (!result.ok && !isGone(result.error)) return options.onStatus('paused')
        await persist(null)
      }
      options.onStatus('ended')
    },
    /** Revoke this device (ends its sessions server-side) and clear the sealed credential. */
    async signOut() {
      halt()
      latest = null
      const cloud = options.cloud
      if (cloud) await ensureCredential(cloud)
      if (cloud && credential) {
        await cloud.call('revokePresentationPublisherDevice', { deviceUid: credential.deviceUid, clientRequestId: clientRequestId() })
      }
      finish('signed-out')
    },
  }
}
