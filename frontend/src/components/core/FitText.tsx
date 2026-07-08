import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

export const FitText = ({
  children,
  min = 32,
  max = 160,
  className = '',
  ratio = 6,
  vhMax,
  vwMax,
}: {
  children: ReactNode
  min?: number
  max?: number
  className?: string
  ratio?: number
  /** Maximum font size as percentage of viewport height (e.g., 25 = 25vh) */
  vhMax?: number
  /** Maximum font size as percentage of viewport width (e.g., 15 = 15vw) */
  vwMax?: number
}) => {
  const ref = useRef<HTMLDivElement>(null)
  const [fontSize, setFontSize] = useState(min)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return

    const updateSize = () => {
      const parent = element.parentElement
      const width = parent?.clientWidth ?? element.clientWidth

      // Calculate width-based font size
      let next = width / ratio

      // Viewport caps keep the Viewer timer stable on extreme aspect ratios.
      // This ensures text fits vertically on wide screens (fullscreen mode)
      if (vhMax !== undefined) {
        const vhSize = (window.innerHeight * vhMax) / 100
        next = Math.min(next, vhSize)
      }

      // Apply viewport width constraint if specified
      // This ensures text fits horizontally on narrow/portrait screens
      if (vwMax !== undefined) {
        const vwSize = (window.innerWidth * vwMax) / 100
        next = Math.min(next, vwSize)
      }

      setFontSize(clamp(next, min, max))
    }

    updateSize()

    // Observe both resize and window resize for viewport-based constraints
    const resizeObserver = new ResizeObserver(updateSize)
    resizeObserver.observe(element.parentElement ?? element)

    const hasViewportConstraints = vhMax !== undefined || vwMax !== undefined
    if (hasViewportConstraints) {
      window.addEventListener('resize', updateSize)
    }

    return () => {
      resizeObserver.disconnect()
      if (hasViewportConstraints) {
        window.removeEventListener('resize', updateSize)
      }
    }
  }, [max, min, ratio, vhMax, vwMax])

  return (
    <div
      ref={ref}
      className={className}
      style={{
        fontSize,
        lineHeight: 1.05,
        fontFamily: 'Space Grotesk, system-ui',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {children}
    </div>
  )
}
