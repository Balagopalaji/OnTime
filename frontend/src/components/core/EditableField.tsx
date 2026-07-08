import { useCallback, useEffect, useRef, useState } from 'react'

type EditableFieldProps = {
  value: string
  onSave: (value: string) => void
  placeholder?: string
  className?: string
  inputClassName?: string
  type?: 'text' | 'number'
  disabled?: boolean
}

export const EditableField = ({
  value,
  onSave,
  placeholder,
  className,
  inputClassName,
  type = 'text',
  disabled = false,
}: EditableFieldProps) => {
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDraft(value)
  }, [value])

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  const commit = useCallback(() => {
    const next = type === 'number' ? draft : draft.trim()
    if (next === value || next === '') {
      setIsEditing(false)
      setDraft(value)
      return
    }
    onSave(next)
    setIsEditing(false)
  }, [draft, onSave, type, value])

  const cancel = useCallback(() => {
    setIsEditing(false)
    setDraft(value)
  }, [value])

  useEffect(() => {
    if (!isEditing) return
    const handleClick = (event: MouseEvent) => {
      if (!inputRef.current) return
      if (!inputRef.current.contains(event.target as Node)) {
        commit()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [commit, isEditing])

  if (disabled) {
    return (
      <span className={className}>
        {value || placeholder}
      </span>
    )
  }

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type={type}
        className={inputClassName}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            cancel()
          }
        }}
      />
    )
  }

  return (
    <button
      type="button"
      className={className}
      onClick={() => setIsEditing(true)}
    >
      {value || placeholder}
    </button>
  )
}
