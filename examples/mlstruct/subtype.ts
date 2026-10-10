import { check, fail, get, scoped, state, within, type Check } from "typerator"
import {
  and,
  anything,
  fn,
  key,
  not,
  nothing,
  or,
  record,
  show,
  tvar,
  type Scheme,
  type Type,
  type Var
} from "./type.ts"

type Atom = Extract<Type, { readonly kind: "var" | "fn" | "record" | "tag" }>

type Literal = { readonly positive: boolean; readonly atom: Atom }

type Bounds = { readonly lower: Type[]; readonly upper: Type[] }

type Solver = { readonly bounds: Map<number, Bounds>; next: number }

type Failure = { readonly found: Type; readonly expected: Type }

export const solver = state<Solver>(
  () => ({ bounds: new Map(), next: 0 }),
  current => {
    const next = current.next
    const entries = [...current.bounds].map(([id, bounds]) => ({
      id,
      bounds,
      lower: [...bounds.lower],
      upper: [...bounds.upper]
    }))
    return () => {
      current.next = next
      current.bounds.clear()
      for (const { id, bounds, lower, upper } of entries) {
        bounds.lower.splice(0, bounds.lower.length, ...lower)
        bounds.upper.splice(0, bounds.upper.length, ...upper)
        current.bounds.set(id, bounds)
      }
    }
  }
)

const level = scoped(0)

const variable = (current: Solver, at: number): Var => tvar(current.next++, at)

const boundsOf = (current: Solver, id: number): Bounds => {
  const known = current.bounds.get(id)
  if (known) return known
  const bounds = { lower: [], upper: [] }
  current.bounds.set(id, bounds)
  return bounds
}

const levelOf = (type: Type): number => {
  switch (type.kind) {
    case "var":
      return type.level
    case "fn":
      return Math.max(levelOf(type.from), levelOf(type.to))
    case "record":
      return Math.max(0, ...[...type.fields.values()].map(levelOf))
    case "and":
    case "or":
      return Math.max(0, ...type.types.map(levelOf))
    case "not":
      return levelOf(type.type)
    default:
      return 0
  }
}

const mapFields = (type: Type, f: (field: Type) => Type) =>
  type.kind === "record"
    ? record([...type.fields].map(([label, t]) => [label, f(t)]))
    : type

const children = (
  type: Type,
  positive: boolean,
  f: (child: Type, positive: boolean) => Type
): Type => {
  switch (type.kind) {
    case "fn":
      return fn(f(type.from, !positive), f(type.to, positive))
    case "record":
      return mapFields(type, field => f(field, positive))
    case "and":
      return and(...type.types.map(part => f(part, positive)))
    case "or":
      return or(...type.types.map(part => f(part, positive)))
    case "not":
      return not(f(type.type, !positive))
    default:
      return type
  }
}

const cross = (
  xs: readonly (readonly Literal[])[],
  ys: readonly (readonly Literal[])[]
) => xs.flatMap(x => ys.map(y => [...x, ...y]))

const dnf = (type: Type, positive: boolean): (readonly Literal[])[] => {
  switch (type.kind) {
    case "top":
      return positive ? [[]] : []
    case "bottom":
      return positive ? [] : [[]]
    case "and":
      return positive
        ? type.types.map(part => dnf(part, true)).reduce(cross, [[]])
        : type.types.flatMap(part => dnf(part, false))
    case "or":
      return positive
        ? type.types.flatMap(part => dnf(part, true))
        : type.types.map(part => dnf(part, false)).reduce(cross, [[]])
    case "not":
      return dnf(type.type, !positive)
    default:
      return [[{ positive, atom: type }]]
  }
}

const atoms = <K extends Atom["kind"]>(
  literals: readonly Literal[],
  positive: boolean,
  kind: K
) =>
  literals
    .filter(literal => literal.positive === positive)
    .map(literal => literal.atom)
    .filter((atom): atom is Extract<Atom, { readonly kind: K }> =>
      atom.kind === kind
    )

const isEmpty = (literals: readonly Literal[]) => {
  const tags = atoms(literals, true, "tag").map(tag => tag.name)
  const vars = atoms(literals, true, "var").map(v => v.id)
  const objects = tags.length > 0 || atoms(literals, true, "record").length > 0
  return (objects && atoms(literals, true, "fn").length > 0)
    || new Set(tags).size > 1
    || atoms(literals, false, "tag").some(tag => tags.includes(tag.name))
    || atoms(literals, false, "var").some(v => vars.includes(v.id))
}

type Solving = { readonly solver: Solver; readonly seen: Set<string> }

const extrude = (
  solving: Solving,
  type: Type,
  positive: boolean,
  at: number,
  copies = new Map<number, Var>()
): Type => {
  if (levelOf(type) <= at) return type
  const go = (inner: Type, polarity = positive) =>
    extrude(solving, inner, polarity, at, copies)
  switch (type.kind) {
    case "var": {
      const known = copies.get(type.id)
      if (known) return known
      const copy = variable(solving.solver, at)
      copies.set(type.id, copy)
      const original = boundsOf(solving.solver, type.id)
      const fresh = boundsOf(solving.solver, copy.id)
      if (positive) {
        original.upper.push(copy)
        fresh.lower.push(...original.lower.map(bound => go(bound)))
      } else {
        original.lower.push(copy)
        fresh.upper.push(...original.upper.map(bound => go(bound)))
      }
      return copy
    }
    default:
      return children(type, positive, go)
  }
}

const bound = (
  solving: Solving,
  target: Var,
  type: Type,
  side: "lower" | "upper"
): Failure | undefined => {
  const extruded = extrude(solving, type, side === "lower", target.level)
  const bounds = boundsOf(solving.solver, target.id)
  if (side === "upper") {
    bounds.upper.push(extruded)
    for (const lower of [...bounds.lower]) {
      const failure = solve(solving, lower, extruded)
      if (failure) return failure
    }
  } else {
    bounds.lower.push(extruded)
    for (const upper of [...bounds.upper]) {
      const failure = solve(solving, extruded, upper)
      if (failure) return failure
    }
  }
  return undefined
}

const structural = (
  solving: Solving,
  literals: readonly Literal[]
): Failure | undefined => {
  const failure = {
    found: and(...literals.filter(l => l.positive).map(l => l.atom)),
    expected: or(...literals.filter(l => !l.positive).map(l => l.atom))
  }
  const functions = atoms(literals, true, "fn")
  const expectedFunctions = atoms(literals, false, "fn")
  if (functions.length > 0) {
    if (expectedFunctions.length === 0) return failure
    const from = or(...functions.map(f => f.from))
    const to = and(...functions.map(f => f.to))
    const expectedFrom = and(...expectedFunctions.map(f => f.from))
    const expectedTo = or(...expectedFunctions.map(f => f.to))
    return solve(solving, expectedFrom, from) ?? solve(solving, to, expectedTo)
  }
  const records = atoms(literals, true, "record")
  const expectedRecords = atoms(literals, false, "record")
  const tags = atoms(literals, true, "tag")
  if (records.length + tags.length === 0) return failure
  const [first, ...others] = expectedRecords
  if (!first) return failure
  const found = and(...records)
  const fields = found.kind === "record"
    ? found.fields
    : new Map<string, Type>()
  for (const label of first.fields.keys()) {
    if (!others.every(expected => expected.fields.has(label))) continue
    const field = fields.get(label)
    if (!field) return failure
    const expected = or(
      ...expectedRecords.flatMap(r => r.fields.get(label) ?? [])
    )
    const inner = solve(solving, field, expected)
    if (inner) return inner
  }
  return undefined
}

const solveConjunct = (
  solving: Solving,
  literals: readonly Literal[]
): Failure | undefined => {
  if (isEmpty(literals)) return undefined
  const target = literals.find(
    (literal): literal is Literal & { readonly atom: Var } =>
      literal.atom.kind === "var"
  )
  if (!target) return structural(solving, literals)
  const rest = and(
    ...literals
      .filter(literal => literal !== target)
      .map(literal => literal.positive ? literal.atom : not(literal.atom))
  )
  return target.positive
    ? bound(solving, target.atom, not(rest), "upper")
    : bound(solving, target.atom, rest, "lower")
}

const solve = (
  solving: Solving,
  found: Type,
  expected: Type
): Failure | undefined => {
  const seen = `${key(found)} <: ${key(expected)}`
  if (solving.seen.has(seen)) return undefined
  solving.seen.add(seen)
  for (const literals of cross(dnf(found, true), dnf(expected, false))) {
    const failure = solveConjunct(solving, literals)
    if (failure) return failure
  }
  return undefined
}

const freshen = (
  current: Solver,
  type: Type,
  above: number,
  at: number,
  copies = new Map<number, Var>()
): Type => {
  if (levelOf(type) <= above) return type
  const go = (inner: Type) => freshen(current, inner, above, at, copies)
  switch (type.kind) {
    case "var": {
      const known = copies.get(type.id)
      if (known) return known
      const copy = variable(current, at)
      copies.set(type.id, copy)
      const original = boundsOf(current, type.id)
      const fresh = boundsOf(current, copy.id)
      fresh.lower.push(...original.lower.map(go))
      fresh.upper.push(...original.upper.map(go))
      return copy
    }
    default:
      return children(type, true, go)
  }
}

const coalesce = (
  current: Solver,
  type: Type,
  positive: boolean,
  visiting: ReadonlySet<string> = new Set()
): Type => {
  const go = (inner: Type, polarity = positive) =>
    coalesce(current, inner, polarity, visiting)
  switch (type.kind) {
    case "var": {
      const visit = `${type.id}${positive ? "+" : "-"}`
      if (visiting.has(visit)) return type
      const inside = new Set(visiting).add(visit)
      const { lower, upper } = boundsOf(current, type.id)
      const bounds = (positive ? lower : upper).map(bound =>
        coalesce(current, bound, positive, inside)
      )
      return positive ? or(type, ...bounds) : and(type, ...bounds)
    }
    default:
      return children(type, positive, go)
  }
}

const polarities = (
  type: Type,
  positive: boolean,
  seen: Map<number, Set<boolean>>
): Map<number, Set<boolean>> => {
  const go = (inner: Type, polarity = positive) =>
    polarities(inner, polarity, seen)
  switch (type.kind) {
    case "var":
      seen.set(type.id, (seen.get(type.id) ?? new Set()).add(positive))
      break
    case "fn":
      go(type.from, !positive)
      go(type.to)
      break
    case "record":
      for (const field of type.fields.values()) go(field)
      break
    case "and":
    case "or":
      for (const part of type.types) go(part)
      break
    case "not":
      go(type.type, !positive)
      break
  }
  return seen
}

const prune = (
  type: Type,
  positive: boolean,
  both: ReadonlySet<number>
): Type => {
  if (type.kind !== "var") {
    return children(
      type,
      positive,
      (child, polarity) => prune(child, polarity, both)
    )
  }
  if (both.has(type.id)) return type
  return positive ? nothing : anything
}

const tidy = (literals: readonly Literal[]) => {
  const tagged = literals.some(l => l.positive && l.atom.kind === "tag")
  return literals.filter(l => !(tagged && !l.positive && l.atom.kind === "tag"))
}

const covers = (general: readonly Literal[], specific: readonly Literal[]) =>
  general.every(l =>
    specific.some(m => m.positive === l.positive && key(m.atom) === key(l.atom))
  )

const normalize = (type: Type): Type => {
  const conjuncts = dnf(type, true)
    .filter(literals => !isEmpty(literals))
    .map(tidy)
  const minimal = conjuncts.filter((conjunct, i) =>
    !conjuncts.some((other, j) =>
      j !== i && covers(other, conjunct) && (!covers(conjunct, other) || j < i)
    )
  )
  return or(
    ...minimal.map(literals =>
      and(
        ...literals.map(({ positive, atom }) => {
          const inner = atom.kind === "fn"
            ? fn(normalize(atom.from), normalize(atom.to))
            : mapFields(atom, normalize)
          return positive ? inner : not(inner)
        })
      )
    )
  )
}

export const fresh = (): Check<Var> =>
  check(function*() {
    return variable(yield* get(solver), yield* get(level))
  })

export const constrain = (found: Type, expected: Type): Check<void> =>
  check(function*() {
    const solving = { solver: yield* get(solver), seen: new Set<string>() }
    const failure = solve(solving, found, expected)
    if (!failure) return
    const names = new Map<number, string>()
    const expectedType = show(failure.expected, names)
    return yield* fail(
      `Expected ${expectedType}, found ${show(failure.found, names)}`
    )
  }).atomic()

export const resolve = (type: Type): Check<Type> =>
  get(solver).map(current => {
    const coalesced = coalesce(current, type, true)
    const seen = polarities(coalesced, true, new Map())
    const both = new Set(
      [...seen].filter(([, polarity]) => polarity.size === 2).map(([id]) => id)
    )
    return normalize(prune(coalesced, true, both))
  })

export const generalize = (body: Check<Type>): Check<Scheme> =>
  check(function*() {
    const at = yield* get(level)
    const type = yield* within(level, n => n + 1, body)
    return { level: at, type }
  })

export const instantiate = (scheme: Scheme): Check<Type> =>
  check(function*() {
    const current = yield* get(solver)
    const at = yield* get(level)
    return freshen(current, scheme.type, scheme.level, at)
  })
