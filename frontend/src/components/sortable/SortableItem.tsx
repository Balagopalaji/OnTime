import type { LiHTMLAttributes, ReactNode } from 'react'

export const SortableItem = ({
  children,
  className = '',
  dragging = false,
  over = false,
  ...rest
}: {
  children: ReactNode
  className?: string
  dragging?: boolean
  over?: boolean
} & LiHTMLAttributes<HTMLLIElement>) => {
  return (
    <li
      {...rest}
      className={`${className} ${dragging ? 'opacity-60' : ''} ${
        over ? 'ring-1 ring-emerald-400/60' : ''
      }`}
    >
      {children}
    </li>
  )
}
