import type { Diagnostic, Span } from "./diagnostic.ts"
import { Scope, state, type Scoped, type State } from "./scope.ts"

type Reply<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: Diagnostic }

const Reply = {
  ok: <A>(value: A): Reply<A> => ({ ok: true, value }),
  error: (message: string): Reply<never> => ({
    ok: false,
    error: { message, context: [] }
  })
}

export type Result<A> =
  | { readonly success: true; readonly value: A }
  | {
    readonly success: false
    readonly errors: readonly [Diagnostic, ...Diagnostic[]]
  }

const diagnostics = state<Diagnostic[]>(() => [], list => [...list])

export class Check<A> {
  readonly step: (scope: Scope) => Reply<A>

  constructor(step: (scope: Scope) => Reply<A>) {
    this.step = step
  }

  *[Symbol.iterator](): Generator<Check<A>, A, unknown> {
    return (yield this) as A
  }

  recover<B>(fallback: Check<B>): Check<A | B>
  recover(this: Check<void>): Check<void>
  recover(fallback: Check<unknown> = pure(undefined)): Check<unknown> {
    return new Check(scope => {
      const reply = this.step(scope)
      if (reply.ok) return reply
      scope.get(diagnostics).push(reply.error)
      return fallback.step(scope)
    })
  }

  map<B>(f: (value: A) => B): Check<B> {
    return new Check(scope => {
      const reply = this.step(scope)
      return reply.ok ? Reply.ok(f(reply.value)) : reply
    })
  }

  flatMap<B>(f: (value: A) => Check<B>): Check<B> {
    return new Check(scope => {
      const reply = this.step(scope)
      return reply.ok ? f(reply.value).step(scope) : reply
    })
  }

  context(label: string): Check<A> {
    return new Check(scope => {
      const reply = this.step(scope)
      return reply.ok
        ? reply
        : {
          ok: false,
          error: { ...reply.error, context: [...reply.error.context, label] }
        }
    })
  }

  at(span: Span | undefined): Check<A> {
    return new Check(scope => {
      const reply = this.step(scope)
      return reply.ok || !span || reply.error.span
        ? reply
        : { ok: false, error: { ...reply.error, span } }
    })
  }
}

export const check = <A>(
  body: () => Generator<Check<unknown>, A, unknown>
): Check<A> =>
  new Check(scope => {
    const iterator = body()
    let current = iterator.next()
    while (!current.done) {
      const reply = current.value.step(scope)
      if (!reply.ok) return reply
      current = iterator.next(reply.value)
    }
    return Reply.ok(current.value)
  })

export const pure = <A>(value: A): Check<A> => new Check(() => Reply.ok(value))

export const fail = (message: string): Check<never> =>
  new Check(() => Reply.error(message))

type Values<Checks extends readonly Check<unknown>[]> = {
  -readonly [K in keyof Checks]: Checks[K] extends Check<infer A> ? A : never
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
  new Check(scope => {
    const before = scope.get(diagnostics).length
    const restore = scope.snapshot()
    const reply = checker.step(scope)
    const [recovered] = scope.get(diagnostics).slice(before)
    if (reply.ok && !recovered) return reply
    restore()
    return recovered ? { ok: false, error: recovered } : reply
  })

export const choice = <A>(
  first: Check<A>,
  ...rest: readonly Check<A>[]
): Check<A> =>
  new Check(scope => {
    const reply = attempt(first).step(scope)
    const [next, ...others] = rest
    if (reply.ok || !next) return reply
    const fallback = choice(next, ...others).step(scope)
    return fallback.ok ? fallback : reply
  })

export const get = <T>(key: State<T> | Scoped<T>): Check<T> =>
  new Check(scope => Reply.ok(scope.get(key)))

export const within = <T, A>(
  key: Scoped<T>,
  update: (value: T) => T,
  body: Check<A>
): Check<A> =>
  new Check(scope => body.step(scope.with(key, update(scope.get(key)))))

export const run = <A>(checker: Check<A>): Result<A> => {
  const scope = new Scope()
  const reply = checker.step(scope)
  const [first, ...rest] = scope.get(diagnostics)
  if (!reply.ok) {
    return {
      success: false,
      errors: first ? [first, ...rest, reply.error] : [reply.error]
    }
  }
  if (first) return { success: false, errors: [first, ...rest] }
  return { success: true, value: reply.value }
}
