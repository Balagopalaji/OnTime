import { type ReactNode, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface TooltipProps {
    content: ReactNode
    shortcut?: string
    children: ReactNode
    side?: 'top' | 'bottom' | 'left' | 'right'
    delay?: number
    className?: string
}

export const Tooltip = ({
    content,
    shortcut,
    children,
    side = 'top',
    delay = 1500,
    className = '',
}: TooltipProps) => {
    const [isVisible, setIsVisible] = useState(false)
    const [position, setPosition] = useState({ top: 0, left: 0 })
    const triggerRef = useRef<HTMLDivElement>(null)
    const timerRef = useRef<number | null>(null)

    const handleMouseEnter = () => {
        timerRef.current = window.setTimeout(() => {
            if (triggerRef.current) {
                const rect = triggerRef.current.getBoundingClientRect()
                const scrollX = window.scrollX
                const scrollY = window.scrollY

                let top = 0
                let left = 0

                // Basic positioning logic (can be refined)
                switch (side) {
                    case 'top':
                        top = rect.top + scrollY - 8
                        left = rect.left + scrollX + rect.width / 2
                        break
                    case 'bottom':
                        top = rect.bottom + scrollY + 8
                        left = rect.left + scrollX + rect.width / 2
                        break
                    case 'left':
                        top = rect.top + scrollY + rect.height / 2
                        left = rect.left + scrollX - 8
                        break
                    case 'right':
                        top = rect.top + scrollY + rect.height / 2
                        left = rect.right + scrollX + 8
                        break
                }

                setPosition({ top, left })
                setIsVisible(true)
            }
        }, delay)
    }

    const handleMouseLeave = () => {
        if (timerRef.current) {
            clearTimeout(timerRef.current)
            timerRef.current = null
        }
        setIsVisible(false)
    }

    useEffect(() => {
        return () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current)
            }
        }
    }, [])

    return (
        <>
            <div
                ref={triggerRef}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                className={`inline-flex ${className}`}
            >
                {children}
            </div>
            {isVisible &&
                createPortal(
                    <div
                        className="pointer-events-none fixed z-50 rounded-lg border border-slate-700 bg-slate-900/95 px-3 py-1.5 text-xs text-white shadow-xl backdrop-blur-sm animate-in fade-in zoom-in-95 duration-100"
                        style={{
                            top: position.top,
                            left: position.left,
                            transform:
                                side === 'top'
                                    ? 'translate(-50%, -100%)'
                                    : side === 'bottom'
                                        ? 'translate(-50%, 0)'
                                        : side === 'left'
                                            ? 'translate(-100%, -50%)'
                                            : 'translate(0, -50%)',
                        }}
                    >
                        <div className="flex items-center gap-2 whitespace-nowrap">
                            <span>{content}</span>
                            {shortcut && (
                                <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                                    {shortcut}
                                </span>
                            )}
                        </div>
                    </div>,
                    document.body,
                )}
        </>
    )
}
