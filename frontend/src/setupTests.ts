import '@testing-library/jest-dom/vitest'

type StorageLike = {
  clear: () => void
  getItem: (key: string) => string | null
  key: (index: number) => string | null
  removeItem: (key: string) => void
  setItem: (key: string, value: string) => void
  length: number
}

const createStorage = (): StorageLike => {
  const store = new Map<string, string>()

  return {
    clear: () => {
      store.clear()
    },
    get length() {
      return store.size
    },
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => {
      store.delete(key)
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value))
    },
  }
}

const installStorageIfMissing = (
  target: Record<string, unknown>,
  property: 'localStorage' | 'sessionStorage',
) => {
  const current = target[property] as Partial<StorageLike> | undefined
  const valid =
    current &&
    typeof current.getItem === 'function' &&
    typeof current.setItem === 'function' &&
    typeof current.removeItem === 'function' &&
    typeof current.clear === 'function'

  if (valid) return

  Object.defineProperty(target, property, {
    configurable: true,
    value: createStorage(),
  })
}

if (typeof globalThis !== 'undefined') {
  installStorageIfMissing(globalThis as Record<string, unknown>, 'localStorage')
  installStorageIfMissing(globalThis as Record<string, unknown>, 'sessionStorage')
}

if (typeof window !== 'undefined') {
  installStorageIfMissing(window as unknown as Record<string, unknown>, 'localStorage')
  installStorageIfMissing(window as unknown as Record<string, unknown>, 'sessionStorage')
}
