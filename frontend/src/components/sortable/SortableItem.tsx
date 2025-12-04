import { forwardRef, type LiHTMLAttributes, type ReactNode } from 'react'

type SortableItemProps = {
  children: ReactNode
  className?: string
  dragging?: boolean
  over?: boolean
  role?: string
  dataIndex?: number
} & LiHTMLAttributes<HTMLLIElement>

export const SortableItem = forwardRef<HTMLLIElement, SortableItemProps>(
  ({ children, className = '', dragging = false, over = false, role = 'listitem', dataIndex, ...rest }, ref) => {
    return (
      <li
        {...rest}
        ref={ref}
        role={role}
        data-sort-index={dataIndex}
        className={`${className} ${dragging ? 'opacity-60' : ''} ${
          over ? 'ring-2 ring-sky-400/70 ring-offset-2 ring-offset-slate-900/80' : ''
        }`}
      >
        {children}
      </li>
    )
  },
)
