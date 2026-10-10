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
  render,
  resolve,
  run,
  show,
  unify,
  type Check,
  type Env,
  type Span,
  type Type
} from "typerator"

export type Expr =
  & { readonly span?: Span }
  & (
    | { readonly kind: "var"; readonly name: string }
    | { readonly kind: "lit"; readonly value: number | boolean }
    | { readonly kind: "lam"; readonly param: string; readonly body: Expr }
    | { readonly kind: "app"; readonly func: Expr; readonly arg: Expr }
    | {
      readonly kind: "let"
      readonly name: string
      readonly value: Expr
      readonly body: Expr
    }
    | {
      readonly kind: "if"
      readonly cond: Expr
      readonly then: Expr
      readonly else: Expr
    }
  )

export const v = (name: string): Expr => ({ kind: "var", name })

export const lit = (value: number | boolean): Expr => ({ kind: "lit", value })

export const lam = (param: string, body: Expr): Expr => ({
  kind: "lam",
  param,
  body
})

export const app = (func: Expr, ...args: readonly Expr[]): Expr =>
  args.reduce<Expr>((func, arg) => ({ kind: "app", func, arg }), func)

export const let_ = (name: string, value: Expr, body: Expr): Expr => ({
  kind: "let",
  name,
  value,
  body
})

export const if_ = (cond: Expr, then: Expr, otherwise: Expr): Expr => ({
  kind: "if",
  cond,
  then,
  else: otherwise
})

export const infer = (expr: Expr): Check<Type> => {
  switch (expr.kind) {
    case "var":
      return check(function*() {
        return yield* instantiate(yield* lookup(expr.name))
      }).at(expr.span)
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
        const arg = yield* infer(expr.arg)
        const result = yield* fresh()
        yield* unify(func, fn(arg, result)).context("function argument").at(
          expr.arg.span
        )
        return result
      })
    case "let":
      return check(function*() {
        const value = yield* generalize(
          yield* infer(expr.value).context(`let ${expr.name}`)
        )
        return yield* local(expr.name, value, infer(expr.body))
      })
    case "if":
      return check(function*() {
        yield* unify(yield* infer(expr.cond), bool)
          .context("if condition")
          .at(expr.cond.span)
        const then = yield* infer(expr.then)
        yield* unify(yield* infer(expr.else), then)
          .context("else branch")
          .at(expr.else.span)
        return then
      })
  }
}

export const prelude: Env = new Map([
  ["add", mono(fn(int, fn(int, int)))],
  ["eq", mono(fn(int, fn(int, bool)))]
])

export const typeOf = (expr: Expr, env = prelude) =>
  run(
    check(function*() {
      return yield* resolve(yield* infer(expr))
    }),
    env
  )

const atom = (expr: Expr): string =>
  expr.kind === "var" || expr.kind === "lit"
    ? format(expr)
    : `(${format(expr)})`

export const format = (expr: Expr): string => {
  switch (expr.kind) {
    case "var":
      return expr.name
    case "lit":
      return String(expr.value)
    case "lam":
      return `fun ${expr.param} -> ${format(expr.body)}`
    case "app":
      return `${
        expr.func.kind === "app" ? format(expr.func) : atom(expr.func)
      } ${atom(expr.arg)}`
    case "let":
      return `let ${expr.name} = ${format(expr.value)} in ${format(expr.body)}`
    case "if":
      return `if ${format(expr.cond)} then ${format(expr.then)} else ${
        format(expr.else)
      }`
  }
}

export const report = (programs: readonly Expr[], env = prelude) => {
  for (const expr of programs) {
    const source = format(expr)
    const result = typeOf(expr, env)
    if (result.success) {
      console.log(`${source}\n  : ${show(result.value)}\n`)
    } else if (result.error.span) {
      console.log(`${render(result.error, source)}\n`)
    } else {
      console.log(`${source}\n${render(result.error)}\n`)
    }
  }
}
