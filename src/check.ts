import type { Diagnostic, Span } from "./diagnostic.ts"
import {
  con,
  extend,
  free,
  show,
  tvar,
  type Scheme,
  type Type
} from "./type.ts"

export type Reply<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: Diagnostic }

export type Result<A> =
  | { readonly success: true; readonly value: A }
  | {
    readonly success: false
    readonly errors: readonly [Diagnostic, ...Diagnostic[]]
  }

export type Env = ReadonlyMap<string, Scheme>

type State = {
  readonly subst: Map<number, Type>
  readonly diagnostics: Diagnostic[]
  next: number
}

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

  recover<B>(fallback: Check<B>): Check<A | B>
  recover(this: Check<void>): Check<void>
  recover(fallback: Check<unknown> = pure(undefined)): Check<unknown> {
    return new Check(scope => {
      const reply = this.step(scope)
      if (reply.ok) return reply
      scope.state.diagnostics.push(reply.error)
      return fallback.step(scope)
    })
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

const children = (type: Type, f: (child: Type) => Type): Type => {
  switch (type.kind) {
    case "var":
      return type
    case "con":
      return con(type.name, ...type.args.map(f))
    case "row":
      return extend(type.label, f(type.type), f(type.rest))
  }
}

const apply = (subst: ReadonlyMap<number, Type>, type: Type): Type => {
  if (type.kind !== "var") return children(type, child => apply(subst, child))
  const bound = subst.get(type.id)
  return bound ? apply(subst, bound) : type
}

const substitute = (type: Type, mapping: ReadonlyMap<number, Type>): Type =>
  type.kind === "var"
    ? (mapping.get(type.id) ?? type)
    : children(type, child => substitute(child, mapping))

type Failure =
  | { readonly kind: "mismatch" }
  | { readonly kind: "infinite"; readonly id: number; readonly type: Type }

type Row = Extract<Type, { readonly kind: "row" }>

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

const tail = (type: Type): Type => type.kind === "row" ? tail(type.rest) : type

const rewrite = (
  state: State,
  row: Type,
  label: string
): readonly [Type, Type] | undefined => {
  const resolved = apply(state.subst, row)
  if (resolved.kind === "row") {
    if (resolved.label === label) return [resolved.type, resolved.rest]
    const found = rewrite(state, resolved.rest, label)
    return found && [found[0], extend(resolved.label, resolved.type, found[1])]
  }
  if (resolved.kind !== "var") return undefined
  const type = tvar(state.next++)
  const rest = tvar(state.next++)
  state.subst.set(resolved.id, extend(label, type, rest))
  return [type, rest]
}

const solveRow = (state: State, row: Row, other: Type): Failure | undefined => {
  const end = tail(row.rest)
  const found = rewrite(state, other, row.label)
  if (!found) return { kind: "mismatch" }
  if (end.kind === "var" && state.subst.has(end.id)) {
    return { kind: "infinite", id: end.id, type: row }
  }
  const [type, rest] = found
  return solve(state, row.type, type) ?? solve(state, row.rest, rest)
}

const solve = (state: State, a: Type, b: Type): Failure | undefined => {
  const x = apply(state.subst, a)
  const y = apply(state.subst, b)
  if (x.kind === "var") return bind(state.subst, x.id, y)
  if (y.kind === "var") return bind(state.subst, y.id, x)
  if (x.kind === "row") return solveRow(state, x, y)
  if (y.kind === "row") return solveRow(state, y, x)
  if (x.name !== y.name || x.args.length !== y.args.length) {
    return { kind: "mismatch" }
  }
  return solveAll(state, x.args, y.args)
}

const solveAll = (
  state: State,
  xs: readonly Type[],
  ys: readonly Type[]
): Failure | undefined => {
  const [x, ...restX] = xs
  const [y, ...restY] = ys
  if (!x || !y) return undefined
  return solve(state, x, y) ?? solveAll(state, restX, restY)
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

const snapshot = (state: State): State => ({
  subst: new Map(state.subst),
  diagnostics: [...state.diagnostics],
  next: state.next
})

const restore = (state: State, saved: State) => {
  state.subst.clear()
  for (const [id, type] of saved.subst) state.subst.set(id, type)
  state.diagnostics.splice(0, Infinity, ...saved.diagnostics)
  state.next = saved.next
}

export const attempt = <A>(checker: Check<A>): Check<A> =>
  new Check(scope => {
    const saved = snapshot(scope.state)
    const reply = checker.step(scope)
    const [recovered] = scope.state.diagnostics.slice(saved.diagnostics.length)
    if (reply.ok && !recovered) return reply
    restore(scope.state, saved)
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

export const run = <A>(checker: Check<A>, env: Env = new Map()): Result<A> => {
  const state: State = { subst: new Map(), diagnostics: [], next: 0 }
  const reply = checker.step({ env, state })
  const [first, ...rest] = state.diagnostics
  if (!reply.ok) {
    return {
      success: false,
      errors: first ? [first, ...rest, reply.error] : [reply.error]
    }
  }
  if (first) return { success: false, errors: [first, ...rest] }
  return { success: true, value: reply.value }
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
    const foundBefore = apply(state.subst, found)
    const expectedBefore = apply(state.subst, expected)
    const failure = solve(state, found, expected)
    if (failure === undefined) return ok(undefined)
    const names = new Map<number, string>()
    const display = (type: Type) => show(type, names)
    if (failure.kind === "mismatch") {
      return error(
        `Expected ${display(expectedBefore)}, found ${display(foundBefore)}`
      )
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
