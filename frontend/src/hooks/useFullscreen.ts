import { useCallback, useEffect, useState, type RefObject } from 'react'

type FullscreenDocument = Document & {
  webkitExitFullscreen?: () => Promise<void>
  msExitFullscreen?: () => Promise<void>
  webkitFullscreenElement?: Element | null
  msFullscreenElement?: Element | null
}

type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void>
  msRequestFullscreen?: () => Promise<void>
}

const fullscreenElement = () => {
  const doc = document as FullscreenDocument
  return (
    doc.fullscreenElement ?? doc.webkitFullscreenElement ?? doc.msFullscreenElement ?? null
  )
}

export const useFullscreen = (targetRef: RefObject<HTMLElement | null>) => {
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    const handleChange = () => {
      setIsFullscreen(fullscreenElement() === targetRef.current)
    }

    document.addEventListener('fullscreenchange', handleChange)
    document.addEventListener('webkitfullscreenchange', handleChange)
    document.addEventListener('MSFullscreenChange', handleChange)
    return () => {
      document.removeEventListener('fullscreenchange', handleChange)
      document.removeEventListener('webkitfullscreenchange', handleChange)
      document.removeEventListener('MSFullscreenChange', handleChange)
    }
  }, [targetRef])

  const enterFullscreen = useCallback(async () => {
    const element = targetRef.current as FullscreenElement | null
    if (!element) return
    const request =
      element.requestFullscreen ??
      element.webkitRequestFullscreen ??
      element.msRequestFullscreen
    if (request) {
      await request.call(element)
    }
  }, [targetRef])

  const exitFullscreen = useCallback(async () => {
    const doc = document as FullscreenDocument
    const exit =
      doc.exitFullscreen ?? doc.webkitExitFullscreen ?? doc.msExitFullscreen
    if (exit) {
      await exit.call(doc)
    }
  }, [])

  const toggleFullscreen = useCallback(async () => {
    if (fullscreenElement() === targetRef.current) {
      await exitFullscreen()
    } else {
      await enterFullscreen()
    }
  }, [enterFullscreen, exitFullscreen, targetRef])

  return {
    isFullscreen,
    enterFullscreen,
    exitFullscreen,
    toggleFullscreen,
  }
}
