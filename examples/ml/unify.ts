import { check, fail, get, scoped, state, type Check } from "typerator"
import {
  con,
  extend,
  free,
  show,
  tvar,
  type Scheme,
  type Type
} from "./type.ts"

export type Env = ReadonlyMap<string, Scheme>

type Solution = { readonly subst: Map<number, Type>; next: number }

export const solution = state<Solution>(
  () => ({ subst: new Map(), next: 0 }),
  current => {
    const subst = new Map(current.subst)
    const next = current.next
    return () => {
      current.subst.clear()
      for (const [id, type] of subst) current.subst.set(id, type)
      current.next = next
    }
  }
)

export const env = scoped<Env>(new Map())

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
  current: Solution,
  row: Type,
  label: string
): readonly [Type, Type] | undefined => {
  const resolved = apply(current.subst, row)
  if (resolved.kind === "row") {
    if (resolved.label === label) return [resolved.type, resolved.rest]
    const found = rewrite(current, resolved.rest, label)
    return found && [found[0], extend(resolved.label, resolved.type, found[1])]
  }
  if (resolved.kind !== "var") return undefined
  const type = tvar(current.next++)
  const rest = tvar(current.next++)
  current.subst.set(resolved.id, extend(label, type, rest))
  return [type, rest]
}

const solveRow = (
  current: Solution,
  row: Row,
  other: Type
): Failure | undefined => {
  const end = tail(row.rest)
  const found = rewrite(current, other, row.label)
  if (!found) return { kind: "mismatch" }
  if (end.kind === "var" && current.subst.has(end.id)) {
    return { kind: "infinite", id: end.id, type: row }
  }
  const [type, rest] = found
  return solve(current, row.type, type) ?? solve(current, row.rest, rest)
}

const solve = (current: Solution, a: Type, b: Type): Failure | undefined => {
  const x = apply(current.subst, a)
  const y = apply(current.subst, b)
  if (x.kind === "var") return bind(current.subst, x.id, y)
  if (y.kind === "var") return bind(current.subst, y.id, x)
  if (x.kind === "row") return solveRow(current, x, y)
  if (y.kind === "row") return solveRow(current, y, x)
  if (x.name !== y.name || x.args.length !== y.args.length) {
    return { kind: "mismatch" }
  }
  for (const [index, arg] of x.args.entries()) {
    const failure = solve(current, arg, y.args[index]!)
    if (failure) return failure
  }
  return undefined
}

const freeInScheme = (subst: ReadonlyMap<number, Type>, scheme: Scheme) =>
  free(scheme.type)
    .filter(id => !scheme.vars.includes(id))
    .flatMap(id => free(apply(subst, tvar(id))))

export const fresh = (): Check<Type> =>
  get(solution).map(current => tvar(current.next++))

export const resolve = (type: Type): Check<Type> =>
  get(solution).map(current => apply(current.subst, type))

export const unify = (found: Type, expected: Type): Check<void> =>
  check(function*() {
    const current = yield* get(solution)
    const foundBefore = apply(current.subst, found)
    const expectedBefore = apply(current.subst, expected)
    const failure = solve(current, found, expected)
    if (failure === undefined) return
    const names = new Map<number, string>()
    const display = (type: Type) => show(type, names)
    if (failure.kind === "mismatch") {
      return yield* fail(
        `Expected ${display(expectedBefore)}, found ${display(foundBefore)}`
      )
    }
    const variable = display(tvar(failure.id))
    return yield* fail(
      `Infinite type: ${variable} occurs in ${display(failure.type)}`
    )
  }).atomic()

export const generalize = (type: Type): Check<Scheme> =>
  check(function*() {
    const { subst } = yield* get(solution)
    const bindings = yield* get(env)
    const bound = new Set(
      [...bindings.values()].flatMap(scheme => freeInScheme(subst, scheme))
    )
    const resolved = apply(subst, type)
    const vars = [...new Set(free(resolved))].filter(id => !bound.has(id))
    return { vars, type: resolved }
  })

export const instantiate = (scheme: Scheme): Check<Type> =>
  check(function*() {
    const mapping = new Map<number, Type>()
    for (const id of scheme.vars) mapping.set(id, yield* fresh())
    return substitute(scheme.type, mapping)
  })
