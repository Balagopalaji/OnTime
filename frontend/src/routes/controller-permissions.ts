type ControllerActionGuardArgs = {
  viewerOnly: boolean
  isReadOnly: boolean
}

export const canPerformControllerAction = ({ viewerOnly, isReadOnly }: ControllerActionGuardArgs): boolean =>
  !viewerOnly && !isReadOnly
