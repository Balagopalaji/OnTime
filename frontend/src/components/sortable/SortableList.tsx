import { forwardRef, type HTMLAttributes, type ReactNode } from 'react'

type SortableListProps = { children: ReactNode; className?: string } & HTMLAttributes<HTMLUListElement>

export const SortableList = forwardRef<HTMLUListElement, SortableListProps>(
  ({ children, className = '', ...rest }, ref) => {
    return (
      <ul ref={ref} className={className} {...rest}>
        {children}
      </ul>
    )
  },
)
