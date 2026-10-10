import {
  bool,
  check,
  int,
  pure,
  render,
  run,
  show,
  unify,
  type Check,
  type Span,
  type Type
} from "typerator"

type Expr =
  & { readonly span?: Span }
  & (
    | { readonly kind: "num"; readonly value: number }
    | { readonly kind: "bool"; readonly value: boolean }
    | { readonly kind: "add"; readonly left: Expr; readonly right: Expr }
    | { readonly kind: "eq"; readonly left: Expr; readonly right: Expr }
    | {
      readonly kind: "if"
      readonly cond: Expr
      readonly then: Expr
      readonly else: Expr
    }
  )

const infer = (expr: Expr): Check<Type> => {
  switch (expr.kind) {
    case "num":
      return pure(int)
    case "bool":
      return pure(bool)
    case "add":
      return check(function*() {
        yield* unify(yield* infer(expr.left), int)
          .context("left operand of +")
          .at(expr.left.span)
        yield* unify(yield* infer(expr.right), int)
          .context("right operand of +")
          .at(expr.right.span)
        return int
      })
    case "eq":
      return check(function*() {
        const left = yield* infer(expr.left)
        yield* unify(yield* infer(expr.right), left)
          .context("right operand of ==")
          .at(expr.right.span)
        return bool
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

const num = (value: number): Expr => ({ kind: "num", value })
const yes: Expr = { kind: "bool", value: true }
const add = (left: Expr, right: Expr): Expr => ({ kind: "add", left, right })
const eq = (left: Expr, right: Expr): Expr => ({ kind: "eq", left, right })
const if_ = (cond: Expr, then: Expr, otherwise: Expr): Expr => ({
  kind: "if",
  cond,
  then,
  else: otherwise
})

const find = (source: string, text: string): Span => {
  const start = source.lastIndexOf(text)
  return { start, end: start + text.length }
}

const programs: readonly [string, Expr][] = [
  ["1 + 2", add(num(1), num(2))],
  ["1 + 2 == 3", eq(add(num(1), num(2)), num(3))],
  ["if true then 1 else 2", if_(yes, num(1), num(2))],
  ["1 + true", add(num(1), { ...yes, span: find("1 + true", "true") })],
  [
    "1 + 2 == true",
    eq(add(num(1), num(2)), { ...yes, span: find("1 + 2 == true", "true") })
  ],
  [
    "if 1 then 2 else 3",
    if_({ ...num(1), span: find("if 1 then 2 else 3", "1") }, num(2), num(3))
  ],
  [
    "if true then 1 else true",
    if_(yes, num(1), { ...yes, span: find("if true then 1 else true", "true") })
  ]
]

for (const [source, expr] of programs) {
  const result = run(infer(expr))
  console.log(
    result.success
      ? `${source}\n  : ${show(result.value)}\n`
      : `${render(result.error, source)}\n`
  )
}
