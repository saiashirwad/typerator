import {
  bind,
  check,
  fail,
  get,
  lookup,
  pure,
  run,
  sequence,
  type Check
} from "typerator"
import type { Expr, TypeExpr } from "./syntax.ts"
import { bool, fn, free, int, mono, record, type Type } from "./type.ts"
import {
  fresh,
  generalize,
  instantiate,
  env,
  resolve,
  solution,
  unify,
  type Env
} from "./unify.ts"

const expect = (expr: Expr, expected: Type, label: string) =>
  infer(expr)
    .flatMap(found => unify(found, expected).recover())
    .context(label)
    .at(expr.span)

const builtins: ReadonlyMap<string, Type> = new Map([
  ["int", int],
  ["bool", bool]
])

const annotation = (
  type: TypeExpr,
  vars = new Map<string, Type>()
): Check<Type> => {
  switch (type.kind) {
    case "name": {
      const known = builtins.get(type.name)
      return known
        ? pure(known)
        : fail(`Unknown type ${type.name}`).at(type.span)
    }
    case "var":
      return check(function*() {
        const known = vars.get(type.name) ?? (yield* fresh())
        vars.set(type.name, known)
        return known
      })
    case "fn":
      return sequence([annotation(type.from, vars), annotation(type.to, vars)])
        .map(([from, to]) => fn(from, to))
    case "record":
      return sequence(
        type.fields.map(([label, field]) =>
          annotation(field, vars).map(type => [label, type] as const)
        )
      ).map(fields => record(fields))
  }
}

export const infer = (expr: Expr): Check<Type> => {
  switch (expr.kind) {
    case "var":
      return lookup(env, expr.name)
        .flatMap(instantiate)
        .at(expr.span)
        .recover(fresh())
    case "lit":
      return pure(typeof expr.value === "number" ? int : bool)
    case "lam":
      return check(function*() {
        const param = yield* fresh()
        const body = yield* bind(
          env,
          [[expr.param, mono(param)]],
          infer(expr.body)
        )
        return fn(param, body)
      })
    case "app":
      return check(function*() {
        const func = yield* infer(expr.func)
        const param = yield* fresh()
        const result = yield* fresh()
        yield* unify(func, fn(param, result))
          .context("function call")
          .at(expr.func.span)
          .recover()
        yield* expect(expr.arg, param, "function argument")
        return result
      })
    case "record":
      return check(function*() {
        const fields = new Map<string, Type>()
        for (const [label, value] of expr.fields) {
          fields.set(label, yield* infer(value))
        }
        return record(fields)
      })
    case "field":
      return check(function*() {
        const type = yield* fresh()
        const rest = yield* fresh()
        yield* expect(
          expr.record,
          record([[expr.label, type]], rest),
          `field ${expr.label}`
        )
        return type
      })
    case "let":
      return check(function*() {
        const value = yield* infer(expr.value)
          .flatMap(generalize)
          .context(`let ${expr.name}`)
        return yield* bind(env, [[expr.name, value]], infer(expr.body))
      })
    case "rec":
      return check(function*() {
        const self = yield* fresh()
        yield* bind(
          env,
          [[expr.name, mono(self)]],
          expect(expr.value, self, `let rec ${expr.name}`)
        )
        const scheme = yield* generalize(self)
        return yield* bind(env, [[expr.name, scheme]], infer(expr.body))
      })
    case "annot":
      return check(function*() {
        const type = yield* annotation(expr.type)
        yield* expect(expr.expr, type, "annotation")
        return type
      })
    case "if":
      return check(function*() {
        yield* expect(expr.cond, bool, "if condition")
        const then = yield* infer(expr.then)
        yield* expect(expr.else, then, "else branch")
        return then
      })
  }
}

export const prelude: Env = new Map([
  ["add", mono(fn(int, fn(int, int)))],
  ["sub", mono(fn(int, fn(int, int)))],
  ["mul", mono(fn(int, fn(int, int)))],
  ["eq", mono(fn(int, fn(int, bool)))]
])

export const typeOf = (expr: Expr, globals = prelude) =>
  run(check(function*() {
    const current = yield* get(solution)
    for (const scheme of globals.values()) {
      for (const id of free(scheme.type)) {
        if (!scheme.vars.includes(id)) {
          current.next = Math.max(current.next, id + 1)
        }
      }
    }
    return yield* bind(env, globals, infer(expr).flatMap(resolve))
  }))
