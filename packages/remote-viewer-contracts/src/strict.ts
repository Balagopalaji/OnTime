import type { ParseError, ParseErrorCode, ParseResult } from './snapshot-types'

/** Internal rejection carrier; never escapes the public parsers. */
class Rejection {
  readonly error: ParseError
  constructor(error: ParseError) {
    this.error = error
  }
}

export function reject(code: ParseErrorCode, path: string): never {
  throw new Rejection({ code, path })
}

export function join(path: string, key: string | number): string {
  return path === '' ? String(key) : `${path}.${key}`
}

/** Run a throwing parse body and convert the first rejection into a result. */
export function runParser<T>(body: () => T): ParseResult<T> {
  try {
    return { ok: true, value: body() }
  } catch (caught) {
    if (caught instanceof Rejection) return { ok: false, error: caught.error }
    throw caught
  }
}

export type UnknownRecord = Record<string, unknown>

/** Require a plain object whose own keys are all in `allowed`. */
export function expectRecord(value: unknown, path: string, allowed: ReadonlySet<string>): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) reject('invalid-shape', path)
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) reject('invalid-shape', path)
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) reject('unknown-key', join(path, key))
  }
  return value as UnknownRecord
}

export function expectEnum<T extends string>(record: UnknownRecord, key: string, path: string, values: readonly T[]): T {
  const value = record[key]
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) reject('invalid-field', join(path, key))
  return value as T
}

export function expectBoolean(record: UnknownRecord, key: string, path: string): boolean {
  const value = record[key]
  if (typeof value !== 'boolean') reject('invalid-field', join(path, key))
  return value
}

export function expectNonNegative(record: UnknownRecord, key: string, path: string): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) reject('invalid-field', join(path, key))
  return value === 0 ? 0 : value
}

export function expectNullableNonNegative(record: UnknownRecord, key: string, path: string): number | null {
  return record[key] === null ? null : expectNonNegative(record, key, path)
}

export function expectInteger(record: UnknownRecord, key: string, path: string, min: number): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) reject('invalid-field', join(path, key))
  return value === 0 ? 0 : value
}

export function expectNullableInteger(record: UnknownRecord, key: string, path: string, min: number): number | null {
  return record[key] === null ? null : expectInteger(record, key, path, min)
}

export function expectOptionalString(record: UnknownRecord, key: string, path: string): string | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') reject('invalid-field', join(path, key))
  return value
}
