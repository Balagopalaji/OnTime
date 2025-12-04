import type { ReactNode } from 'react'

export const SortableList = ({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) => {
  return <ul className={className}>{children}</ul>
}
