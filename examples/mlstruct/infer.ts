import { check, pure, run, type Check } from "typerator"
import {
  and,
  bool,
  constrain,
  fn,
  fresh,
  generalize,
  instantiate,
  int,
  local,
  lookup,
  mono,
  not,
  or,
  record,
  resolve,
  tag,
  type Env,
  type Type
} from "typerator/subtype"
import type { Expr } from "./syntax.ts"

const expect = (expr: Expr, expected: Type, label: string) =>
  infer(expr)
    .flatMap(found => constrain(found, expected))
    .context(label)
    .at(expr.span)
    .recover()

const fields = (entries: readonly (readonly [string, Expr])[]) =>
  check(function*() {
    const types = new Map<string, Type>()
    for (const [label, value] of entries) types.set(label, yield* infer(value))
    return record(types)
  })

const refine = (scrutinee: Expr, type: Type, body: Expr) =>
  scrutinee.kind === "var"
    ? local(scrutinee.name, mono(type), infer(body))
    : infer(body)

export const infer = (expr: Expr): Check<Type> => {
  switch (expr.kind) {
    case "var":
      return lookup(expr.name)
        .flatMap(instantiate)
        .at(expr.span)
        .recover(fresh())
    case "lit":
      return pure(typeof expr.value === "number" ? int : bool)
    case "lam":
      return check(function*() {
        const param = yield* fresh()
        const body = yield* local(expr.param, mono(param), infer(expr.body))
        return fn(param, body)
      })
    case "app":
      return check(function*() {
        const func = yield* infer(expr.func)
        const param = yield* fresh()
        const result = yield* fresh()
        yield* constrain(func, fn(param, result))
          .context("function call")
          .at(expr.func.span)
          .recover()
        yield* expect(expr.arg, param, "function argument")
        return result
      })
    case "record":
      return fields(expr.fields)
    case "instance":
      return fields(expr.fields).map(type => and(tag(expr.tag), type))
    case "field":
      return check(function*() {
        const type = yield* fresh()
        yield* expect(
          expr.record,
          record({ [expr.label]: type }),
          `field ${expr.label}`
        )
        return type
      })
    case "let":
      return check(function*() {
        const value = yield* generalize(infer(expr.value))
          .context(`let ${expr.name}`)
        return yield* local(expr.name, value, infer(expr.body))
      })
    case "if":
      return check(function*() {
        yield* expect(expr.cond, bool, "if condition")
        return or(yield* infer(expr.then), yield* infer(expr.else))
      })
    case "is":
      return check(function*() {
        const matched = yield* fresh()
        const unmatched = yield* fresh()
        const test = tag(expr.tag)
        yield* expect(
          expr.scrutinee,
          or(and(test, matched), and(not(test), unmatched)),
          `is ${expr.tag}`
        )
        const then = yield* refine(expr.scrutinee, matched, expr.then)
        const otherwise = yield* refine(expr.scrutinee, unmatched, expr.else)
        return or(then, otherwise)
      })
  }
}

export const prelude: Env = new Map([
  ["add", mono(fn(int, fn(int, int)))],
  ["eq", mono(fn(int, fn(int, bool)))]
])

export const typeOf = (expr: Expr) =>
  run(local(prelude, infer(expr).flatMap(resolve)))
