type ControllerWriteGuardArgs = {
  viewerOnly: boolean
  isReadOnly: boolean
}

export const VIEWER_ONLY_PREFERENCE_SCOPE = 'ephemeral'

type LockRecoveryGuardArgs = {
  viewerOnly: boolean
  isCloudOffline: boolean
}

type HandoverGuardArgs = {
  viewerOnly: boolean
  canHandOver: boolean
  lockState: 'authoritative' | 'read-only' | 'requesting' | 'displaced'
}

export const canPerformWriteAction = ({ viewerOnly, isReadOnly }: ControllerWriteGuardArgs): boolean =>
  !viewerOnly && !isReadOnly

export const canPerformLockRecoveryAction = ({ viewerOnly, isCloudOffline }: LockRecoveryGuardArgs): boolean =>
  !viewerOnly && !isCloudOffline

export const canPerformHandoverAction = ({
  viewerOnly,
  canHandOver,
  lockState,
}: HandoverGuardArgs): boolean => !viewerOnly && canHandOver && lockState === 'authoritative'

export const canRequestControl = ({
  lockRecoveryAllowed,
  lockState,
}: {
  lockRecoveryAllowed: boolean
  lockState: 'authoritative' | 'read-only' | 'requesting' | 'displaced'
}): boolean => lockRecoveryAllowed && lockState !== 'requesting'

export const canForceTakeover = ({
  lockRecoveryAllowed,
  forceTakeoverInFlight,
  forceTakeoverReady,
  canForceNow,
}: {
  lockRecoveryAllowed: boolean
  forceTakeoverInFlight: boolean
  forceTakeoverReady: boolean
  canForceNow: boolean
}): boolean => lockRecoveryAllowed && !forceTakeoverInFlight && (forceTakeoverReady || canForceNow)
