import type { Diagnostic, Span } from "./diagnostic.ts"

export type Result<A> =
  | { readonly success: true; readonly value: A }
  | {
    readonly success: false
    readonly errors: readonly [Diagnostic, ...Diagnostic[]]
  }

type Reply<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: Diagnostic }

const invariant = Symbol()

export type State<T> = {
  readonly kind: "state"
  readonly [invariant]: (value: T) => T
  init(): T
  checkpoint(value: T): () => void
}

export type Scoped<T> = {
  readonly kind: "scoped"
  readonly initial: T
  readonly [invariant]: (value: T) => T
}

export const state = <T>(
  init: () => T,
  checkpoint: (value: T) => () => void
): State<T> => ({
  kind: "state",
  init,
  checkpoint,
  [invariant]: value => value
})

export const scoped = <T>(initial: T): Scoped<T> => ({
  kind: "scoped",
  initial,
  [invariant]: value => value
})

type Storage = {
  readonly states: Map<object, {
    readonly value: unknown
    checkpoint(): () => void
  }>
  readonly errors: Diagnostic[]
}

class Runtime {
  readonly storage: Storage
  readonly values: ReadonlyMap<object, unknown>
  readonly labels: readonly string[]
  readonly span: Span | undefined

  constructor(
    storage: Storage = { states: new Map(), errors: [] },
    values: ReadonlyMap<object, unknown> = new Map(),
    labels: readonly string[] = [],
    span?: Span
  ) {
    this.storage = storage
    this.values = values
    this.labels = labels
    this.span = span
  }

  get<T>(key: State<T> | Scoped<T>): T {
    if (key.kind === "scoped") {
      return (this.values.has(key) ? this.values.get(key) : key.initial) as T
    }
    const known = this.storage.states.get(key)
    if (known) return known.value as T
    const value = key.init()
    this.storage.states.set(key, {
      value,
      checkpoint: () => key.checkpoint(value)
    })
    return value
  }

  checkpoint(): () => void {
    const saved = [...this.storage.states].map(([key, entry]) => ({
      key,
      entry,
      restore: entry.checkpoint()
    }))
    return () => {
      this.storage.states.clear()
      for (const { key, entry, restore } of saved) {
        restore()
        this.storage.states.set(key, entry)
      }
    }
  }
}

export class Check<A> {
  readonly step: (runtime: Runtime) => Reply<A>

  constructor(step: (runtime: Runtime) => Reply<A>) {
    this.step = step
  }

  *[Symbol.iterator](): Generator<Check<A>, A, unknown> {
    return (yield this) as A
  }

  map<B>(f: (value: A) => B): Check<B> {
    return new Check(runtime => {
      const reply = this.step(runtime)
      return reply.ok ? { ok: true, value: f(reply.value) } : reply
    })
  }

  flatMap<B>(f: (value: A) => Check<B>): Check<B> {
    return new Check(runtime => {
      const reply = this.step(runtime)
      return reply.ok ? f(reply.value).step(runtime) : reply
    })
  }

  recover<B>(fallback: Check<B>): Check<A | B>
  recover(this: Check<void>): Check<void>
  recover(fallback: Check<unknown> = pure(undefined)): Check<unknown> {
    return new Check(runtime => {
      const reply = this.step(runtime)
      if (reply.ok) return reply
      runtime.storage.errors.push(reply.error)
      return fallback.step(runtime)
    })
  }

  atomic(): Check<A> {
    return new Check(runtime => {
      const restore = runtime.checkpoint()
      try {
        const reply = this.step(runtime)
        if (!reply.ok) restore()
        return reply
      } catch (error) {
        restore()
        throw error
      }
    })
  }

  context(label: string): Check<A> {
    return new Check(runtime =>
      this.step(
        new Runtime(
          runtime.storage,
          runtime.values,
          [label, ...runtime.labels],
          runtime.span
        )
      )
    )
  }

  at(span: Span | undefined): Check<A> {
    if (span === undefined) return this
    return new Check(runtime =>
      this.step(
        new Runtime(
          runtime.storage,
          runtime.values,
          runtime.labels,
          span
        )
      )
    )
  }
}

export const check = <A>(
  body: () => Generator<Check<unknown>, A, unknown>
): Check<A> =>
  new Check(runtime => {
    const iterator = body()
    let current = iterator.next()
    try {
      while (!current.done) {
        const reply = current.value.step(runtime)
        if (!reply.ok) return reply
        current = iterator.next(reply.value)
      }
      return { ok: true, value: current.value }
    } finally {
      if (!current.done && !iterator.return(undefined as A).done) {
        throw new TypeError("Checks cannot be yielded during generator cleanup")
      }
    }
  })

export const pure = <A>(value: A): Check<A> =>
  new Check(() => ({ ok: true, value }))

export const fail = (message: string): Check<never> =>
  new Check(runtime => ({
    ok: false,
    error: runtime.span === undefined
      ? { message, context: runtime.labels }
      : { message, context: runtime.labels, span: runtime.span }
  }))

type Value<C> = C extends Check<infer A> ? A : never

type Values<Checks extends readonly Check<unknown>[]> = {
  -readonly [K in keyof Checks]: Value<Checks[K]>
}

export const sequence = <const Checks extends readonly Check<unknown>[]>(
  checks: Checks
): Check<Values<Checks>> =>
  check(function*() {
    const values: unknown[] = []
    for (const checker of checks) values.push(yield* checker)
    return values as Values<Checks>
  })

export const attempt = <A>(checker: Check<A>): Check<A> =>
  new Check(runtime => {
    const start = runtime.storage.errors.length
    const restore = runtime.checkpoint()
    try {
      const reply = checker.step(runtime)
      const recovered = runtime.storage.errors[start]
      if (reply.ok && !recovered) return reply
      restore()
      runtime.storage.errors.length = start
      return recovered ? { ok: false, error: recovered } : reply
    } catch (error) {
      restore()
      runtime.storage.errors.length = start
      throw error
    }
  })

export const choice = <
  const Checks extends readonly [Check<unknown>, ...Check<unknown>[]]
>(...checks: Checks): Check<Value<Checks[number]>> =>
  new Check(runtime => {
    const [first, ...rest] = checks
    const initial = attempt(first).step(runtime)
    if (initial.ok) return initial as Reply<Value<Checks[number]>>
    for (const checker of rest) {
      const reply = attempt(checker).step(runtime)
      if (reply.ok) return reply as Reply<Value<Checks[number]>>
    }
    return initial
  })

export const get = <T>(key: State<T> | Scoped<T>): Check<T> =>
  new Check(runtime => ({ ok: true, value: runtime.get(key) }))

export const within = <T, A>(
  key: Scoped<T>,
  update: (value: T) => T,
  body: Check<A>
): Check<A> =>
  new Check(runtime =>
    body.step(
      new Runtime(
        runtime.storage,
        new Map(runtime.values).set(key, update(runtime.get(key))),
        runtime.labels,
        runtime.span
      )
    )
  )

type Names<S> = Scoped<ReadonlyMap<string, S>>

export const lookup = <S>(env: Names<S>, name: string): Check<S> =>
  get(env).flatMap(current =>
    current.has(name)
      ? pure(current.get(name) as S)
      : fail(`Unbound variable: ${name}`)
  )

export const bind = <S, A>(
  env: Names<S>,
  bindings: Iterable<readonly [string, S]>,
  body: Check<A>
): Check<A> => within(env, current => new Map([...current, ...bindings]), body)

export const run = <A>(checker: Check<A>): Result<A> => {
  const runtime = new Runtime()
  const reply = checker.step(runtime)
  const [first, ...rest] = runtime.storage.errors
  if (!reply.ok) {
    return {
      success: false,
      errors: first ? [first, ...rest, reply.error] : [reply.error]
    }
  }
  return first
    ? { success: false, errors: [first, ...rest] }
    : { success: true, value: reply.value }
}
