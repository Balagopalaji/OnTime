export const randomId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return Math.random().toString(36).slice(2, 10)
}

export const delay = (ms = 150) => new Promise((resolve) => setTimeout(resolve, ms))
