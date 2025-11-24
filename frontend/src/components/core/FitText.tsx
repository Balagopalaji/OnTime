import { useEffect, useRef, useState, type ReactNode } from 'react'

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

export const FitText = ({
  children,
  min = 32,
  max = 160,
  className = '',
  ratio = 6,
}: {
  children: ReactNode
  min?: number
  max?: number
  className?: string
  ratio?: number
}) => {
  const ref = useRef<HTMLDivElement>(null)
  const [fontSize, setFontSize] = useState(max)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    const updateSize = () => {
      const width = element.parentElement?.clientWidth ?? element.clientWidth
      const next = clamp(width / ratio, min, max)
      setFontSize(next)
    }

    updateSize()
    const resizeObserver = new ResizeObserver(updateSize)
    resizeObserver.observe(element.parentElement ?? element)
    return () => resizeObserver.disconnect()
  }, [max, min, ratio])

  return (
    <div
      ref={ref}
      className={className}
      style={{ fontSize, lineHeight: 1.05, fontFamily: 'Space Grotesk, system-ui' }}
    >
      {children}
    </div>
  )
}
