export const getCloudViewerOrigin = (): string => {
  const explicit = import.meta.env.VITE_WEB_APP_ORIGIN
  if (explicit) return explicit.replace(/\/+$/, '')
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID
  if (projectId) return `https://${projectId}.web.app`
  if (typeof window !== 'undefined') return window.location.origin
  return ''
}

export const getCloudViewerUrl = (roomId: string): string => {
  const origin = getCloudViewerOrigin()
  return origin ? `${origin}/room/${roomId}/view` : ''
}
