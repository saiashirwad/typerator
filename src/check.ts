import type { Diagnostic, Span } from "./diagnostic.ts"
import { con, free, show, tvar, type Scheme, type Type } from "./type.ts"

export type Reply<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: Diagnostic }

export type Result<A> =
  | { readonly success: true; readonly value: A }
  | { readonly success: false; readonly error: Diagnostic }

export type Env = ReadonlyMap<string, Scheme>

type State = { readonly subst: Map<number, Type>; next: number }

export type Scope = {
  readonly env: Env
  readonly state: State
}

export class Check<A> {
  readonly step: (scope: Scope) => Reply<A>

  constructor(step: (scope: Scope) => Reply<A>) {
    this.step = step
  }

  *[Symbol.iterator](): Generator<Check<A>, A, unknown> {
    return (yield this) as A
  }

  map<B>(f: (value: A) => B): Check<B> {
    return new Check(scope => {
      const reply = this.step(scope)
      return reply.ok ? ok(f(reply.value)) : reply
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

const ok = <A>(value: A): Reply<A> => ({ ok: true, value })

const error = (message: string): Reply<never> => ({
  ok: false,
  error: { message, context: [] }
})

const apply = (subst: ReadonlyMap<number, Type>, type: Type): Type => {
  if (type.kind === "con") {
    return con(type.name, ...type.args.map(arg => apply(subst, arg)))
  }
  const bound = subst.get(type.id)
  return bound ? apply(subst, bound) : type
}

const substitute = (type: Type, mapping: ReadonlyMap<number, Type>): Type =>
  type.kind === "var"
    ? (mapping.get(type.id) ?? type)
    : con(type.name, ...type.args.map(arg => substitute(arg, mapping)))

type Failure =
  | { readonly kind: "mismatch" }
  | { readonly kind: "infinite"; readonly id: number; readonly type: Type }

const bind = (
  subst: Map<number, Type>,
  id: number,
  type: Type
): Failure | undefined => {
  if (type.kind === "var" && type.id === id) return undefined
  if (free(type).includes(id)) return { kind: "infinite", id, type }
  subst.set(id, type)
  return undefined
}

const solve = (
  subst: Map<number, Type>,
  a: Type,
  b: Type
): Failure | undefined => {
  const x = apply(subst, a)
  const y = apply(subst, b)
  if (x.kind === "var") return bind(subst, x.id, y)
  if (y.kind === "var") return bind(subst, y.id, x)
  if (x.name !== y.name || x.args.length !== y.args.length) {
    return { kind: "mismatch" }
  }
  return solveAll(subst, x.args, y.args)
}

const solveAll = (
  subst: Map<number, Type>,
  xs: readonly Type[],
  ys: readonly Type[]
): Failure | undefined => {
  const [x, ...restX] = xs
  const [y, ...restY] = ys
  if (!x || !y) return undefined
  return solve(subst, x, y) ?? solveAll(subst, restX, restY)
}

const freeInScheme = (subst: ReadonlyMap<number, Type>, scheme: Scheme) =>
  free(scheme.type)
    .filter(id => !scheme.vars.includes(id))
    .flatMap(id => free(apply(subst, tvar(id))))

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
    return ok(current.value)
  })

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

const restore = (state: State, saved: State) => {
  state.subst.clear()
  for (const [id, type] of saved.subst) state.subst.set(id, type)
  state.next = saved.next
}

export const attempt = <A>(checker: Check<A>): Check<A> =>
  new Check(scope => {
    const saved = { subst: new Map(scope.state.subst), next: scope.state.next }
    const reply = checker.step(scope)
    if (!reply.ok) restore(scope.state, saved)
    return reply
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

export const run = <A>(checker: Check<A>, env: Env = new Map()): Result<A> => {
  const reply = checker.step({ env, state: { subst: new Map(), next: 0 } })
  return reply.ok
    ? { success: true, value: reply.value }
    : { success: false, error: reply.error }
}

export const pure = <A>(value: A): Check<A> => new Check(() => ok(value))

export const fail = (message: string): Check<never> =>
  new Check(() => error(message))

export const fresh = (): Check<Type> =>
  new Check(({ state }) => ok(tvar(state.next++)))

export const resolve = (type: Type): Check<Type> =>
  new Check(({ state }) => ok(apply(state.subst, type)))

export const unify = (found: Type, expected: Type): Check<void> =>
  new Check(({ state }) => {
    const failure = solve(state.subst, found, expected)
    if (failure === undefined) return ok(undefined)
    const names = new Map<number, string>()
    const display = (type: Type) => show(apply(state.subst, type), names)
    if (failure.kind === "mismatch") {
      return error(`Expected ${display(expected)}, found ${display(found)}`)
    }
    const variable = display(tvar(failure.id))
    return error(
      `Infinite type: ${variable} occurs in ${display(failure.type)}`
    )
  })

export const lookup = (name: string): Check<Scheme> =>
  new Check(({ env }) => {
    const scheme = env.get(name)
    return scheme ? ok(scheme) : error(`Unbound variable: ${name}`)
  })

export const local = <A>(
  name: string,
  scheme: Scheme,
  body: Check<A>
): Check<A> =>
  new Check(scope =>
    body.step({ ...scope, env: new Map(scope.env).set(name, scheme) })
  )

export const generalize = (type: Type): Check<Scheme> =>
  new Check(({ env, state }) => {
    const bound = new Set(
      [...env.values()].flatMap(scheme => freeInScheme(state.subst, scheme))
    )
    const resolved = apply(state.subst, type)
    const vars = [...new Set(free(resolved))].filter(id => !bound.has(id))
    return ok({ vars, type: resolved })
  })

export const instantiate = (scheme: Scheme): Check<Type> =>
  check(function*() {
    const mapping = new Map<number, Type>()
    for (const id of scheme.vars) mapping.set(id, yield* fresh())
    return substitute(scheme.type, mapping)
  })
