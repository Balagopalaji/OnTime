import { useEffect, useState } from 'react'
import { toDataURL } from 'qrcode'

type LocalQrCodeProps = {
  value: string
  size?: number
  className?: string
  onError?: () => void
}

export const LocalQrCode = ({ value, size = 240, className, onError }: LocalQrCodeProps) => {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [dataValue, setDataValue] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    if (!value) return () => {}

    void toDataURL(value, { width: size, margin: 1 })
      .then((url) => {
        if (!cancelled) {
          setDataUrl(url)
          setDataValue(value)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDataUrl(null)
          onError?.()
        }
      })

    return () => {
      cancelled = true
    }
  }, [onError, size, value])

  if (!value) return null
  const isStale = dataValue !== value
  if (!dataUrl || isStale) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">
        Generating QR...
      </div>
    )
  }

  return <img src={dataUrl} alt="QR code" className={className} />
}
