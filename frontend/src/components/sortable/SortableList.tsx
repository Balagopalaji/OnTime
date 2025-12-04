import type { HTMLAttributes, ReactNode } from 'react'

export const SortableList = ({
  children,
  className = '',
  ...rest
}: { children: ReactNode; className?: string } & HTMLAttributes<HTMLUListElement>) => {
  return (
    <ul className={className} {...rest}>
      {children}
    </ul>
  )
}
