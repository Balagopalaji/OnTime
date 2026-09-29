import { useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../lib/firebase'

/**
 * ISSUE-002 publisher-device approval (endpoints: "Approve device"). The owner
 * approves a PPT Timer that started a PKCE challenge; the one-time code goes
 * back to that app only through its registered callback scheme.
 */

type ApproveRequest = { challengeId: string; decision: 'approve' | 'deny' }
type ApproveResult = { status: 'approved'; callbackUrl: string } | { status: 'denied' }
export type ApproveDecision = (request: ApproveRequest) => Promise<ApproveResult>

const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{22,64}$/
/** Only the PPT Timer's registered scheme is ever opened (the server pins the same scheme). */
const CALLBACK_SCHEME = import.meta.env.VITE_PRESENTATION_CALLBACK_SCHEME ?? 'downstage-ppt-timer'
const APP_CALLBACK = new RegExp(`^${CALLBACK_SCHEME.replace(/[.+-]/g, '\\$&')}://publisher-auth\\?`)

const INVALID_LINK = 'This approval link is not valid. Start again from PPT Timer.'
const ERROR_COPY: Record<string, string> = {
  'functions/failed-precondition': 'This request was already used. Start again from PPT Timer.',
  'functions/deadline-exceeded': 'This request expired. Start again from PPT Timer.',
  'functions/not-found': INVALID_LINK,
  'functions/permission-denied': 'Sign in with your own OnTime account to approve devices.',
}
const FALLBACK_ERROR = 'Could not reach OnTime. Check your connection and try again.'

const defaultApprove: ApproveDecision = async (request) => {
  if (!functions) throw Object.assign(new Error('Firebase is not configured'), { code: 'functions/unavailable' })
  const result = await httpsCallable<ApproveRequest, ApproveResult>(functions, 'approvePresentationPublisherAuth')(request)
  return result.data
}

type Outcome = { kind: 'idle' | 'pending' } | { kind: 'approved'; callbackUrl: string } | { kind: 'denied' } | { kind: 'error'; message: string }

export function PublisherDeviceApprovalPage({
  approve = defaultApprove,
  openCallback = (url: string) => window.location.assign(url),
}: {
  approve?: ApproveDecision
  openCallback?: (url: string) => void
}) {
  const [params] = useSearchParams()
  const challengeId = params.get('challenge') ?? ''
  const valid = CHALLENGE_PATTERN.test(challengeId)
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' })
  // A ref, not state: two clicks in one tick must still send a single decision.
  const inFlight = useRef(false)

  const decide = async (decision: ApproveRequest['decision']) => {
    if (inFlight.current) return
    inFlight.current = true
    setOutcome({ kind: 'pending' })
    try {
      const result = await approve({ challengeId, decision })
      if (result.status === 'denied') {
        setOutcome({ kind: 'denied' })
      } else if (APP_CALLBACK.test(result.callbackUrl)) {
        setOutcome({ kind: 'approved', callbackUrl: result.callbackUrl })
        openCallback(result.callbackUrl)
      } else {
        setOutcome({ kind: 'error', message: FALLBACK_ERROR })
        inFlight.current = false
      }
    } catch (error) {
      setOutcome({ kind: 'error', message: ERROR_COPY[(error as { code?: string }).code ?? ''] ?? FALLBACK_ERROR })
      inFlight.current = false
    }
  }

  const pending = outcome.kind === 'pending'
  return (
    <section className="mx-auto max-w-lg space-y-4 rounded-lg border border-slate-800 bg-slate-900/40 p-6 text-slate-200">
      <h1 className="text-xl font-semibold text-white">Link PPT Timer to your account?</h1>
      {!valid ? (
        <p role="alert" className="text-sm text-rose-300">
          {INVALID_LINK}
        </p>
      ) : outcome.kind === 'approved' ? (
        <div className="space-y-2 text-sm">
          <p>Approved. Returning to PPT Timer…</p>
          <a className="text-emerald-300 underline" href={outcome.callbackUrl}>
            Open PPT Timer
          </a>
        </div>
      ) : outcome.kind === 'denied' ? (
        <p className="text-sm">Denied. No device was linked; you can close this tab.</p>
      ) : (
        <>
          <p className="text-sm text-slate-300">
            Only approve if you just chose Share Remotely in PPT Timer on this computer. The app will publish presentation
            timing under your account; viewers only ever get read-only links you share.
          </p>
          {outcome.kind === 'error' && (
            <p role="alert" className="text-sm text-rose-300">
              {outcome.message}
            </p>
          )}
          <div className="flex gap-3">
            <button
              type="button"
              disabled={pending}
              onClick={() => void decide('approve')}
              className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Approve
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => void decide('deny')}
              className="rounded-md border border-slate-700 px-4 py-2 text-sm text-slate-200 disabled:opacity-50"
            >
              Deny
            </button>
          </div>
        </>
      )}
    </section>
  )
}
