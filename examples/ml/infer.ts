import {
  bool,
  check,
  fn,
  fresh,
  generalize,
  instantiate,
  int,
  local,
  lookup,
  mono,
  pure,
  resolve,
  run,
  unify,
  type Check,
  type Env,
  type Type
} from "typerator"
import type { Expr } from "./syntax.ts"

const expect = (expr: Expr, expected: Type, label: string) =>
  infer(expr)
    .flatMap(found => unify(found, expected))
    .context(label)
    .at(expr.span)

export const infer = (expr: Expr): Check<Type> => {
  switch (expr.kind) {
    case "var":
      return lookup(expr.name).flatMap(instantiate).at(expr.span)
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
        yield* unify(func, fn(param, result))
          .context("function call")
          .at(expr.func.span)
        yield* expect(expr.arg, param, "function argument")
        return result
      })
    case "let":
      return check(function*() {
        const value = yield* infer(expr.value)
          .flatMap(generalize)
          .context(`let ${expr.name}`)
        return yield* local(expr.name, value, infer(expr.body))
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
  ["eq", mono(fn(int, fn(int, bool)))]
])

export const typeOf = (expr: Expr, env = prelude) =>
  run(infer(expr).flatMap(resolve), env)
