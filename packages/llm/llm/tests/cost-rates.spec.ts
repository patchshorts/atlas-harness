import { describe, expect, it } from 'vitest'
import {
  emptyRateTable,
  ModelRateSchema,
  ModelRateTableSchema,
} from '../src/cost/rates.ts'

describe('model rate table', () => {
  it('defaults to an empty table (no fabricated pricing)', () => {
    expect(emptyRateTable()).toEqual({})
    expect(ModelRateTableSchema(undefined)).toEqual({})
  })

  it('parses a full rate with all cache fields', () => {
    expect(
      ModelRateSchema({
        inputPerM: 30,
        outputPerM: 60,
        cacheReadPerM: 3,
        cacheWritePerM: 30,
      }),
    ).toEqual({
      inputPerM: 30,
      outputPerM: 60,
      cacheReadPerM: 3,
      cacheWritePerM: 30,
    })
  })

  it('treats cache fields as optional', () => {
    expect(ModelRateSchema({ inputPerM: 30, outputPerM: 60 })).toEqual({
      inputPerM: 30,
      outputPerM: 60,
    })
  })

  it('parses a table of multiple models', () => {
    const table = ModelRateTableSchema({
      'deepseek-v4-flash': { inputPerM: 30, outputPerM: 60 },
      'deepseek-v4': { inputPerM: 300, outputPerM: 600, cacheReadPerM: 30 },
    })

    expect(table['deepseek-v4-flash']).toEqual({ inputPerM: 30, outputPerM: 60 })
    expect(table['deepseek-v4']).toEqual({
      inputPerM: 300,
      outputPerM: 600,
      cacheReadPerM: 30,
    })
  })

  it.each([
    ['a negative input price', { inputPerM: -1, outputPerM: 60 }],
    ['a negative output price', { inputPerM: 30, outputPerM: -1 }],
    ['a negative cache-read price', { inputPerM: 30, outputPerM: 60, cacheReadPerM: -0.5 }],
    ['a negative cache-write price', { inputPerM: 30, outputPerM: 60, cacheWritePerM: -1 }],
  ] as const)('rejects %s', (_label, rate) => {
    expect(() => ModelRateSchema(rate as never)).toThrow()
  })

  it('requires input and output prices', () => {
    expect(() => ModelRateSchema({ outputPerM: 60 } as never)).toThrow(/inputPerM/)
    expect(() => ModelRateSchema({ inputPerM: 30 } as never)).toThrow(/outputPerM/)
  })

  it('rejects a non-object table entry', () => {
    expect(() =>
      ModelRateTableSchema({ 'deepseek-v4-flash': 42 } as never),
    ).toThrow()
  })
})
