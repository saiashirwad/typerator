import {
  between,
  choice as oneOf,
  commit,
  eof,
  parser,
  precedence,
  recursive,
  regex,
  type Parser
} from "parserator"
import {
  bool,
  check,
  choice,
  con,
  int,
  pure,
  run,
  unify,
  type Check,
  type Span,
  type Type
} from "typerator"
import { keyword, located, spaces, symbol, token } from "./lexer.ts"
import { report } from "./report.ts"

type Node =
  | { readonly kind: "num"; readonly value: number }
  | { readonly kind: "str"; readonly value: string }
  | { readonly kind: "bool"; readonly value: boolean }
  | { readonly kind: "add"; readonly left: Expr; readonly right: Expr }
  | { readonly kind: "eq"; readonly left: Expr; readonly right: Expr }
  | {
    readonly kind: "if"
    readonly cond: Expr
    readonly then: Expr
    readonly else: Expr
  }

type Expr = Node & { readonly span?: Span }

const Expr = {
  num: (value: number): Expr => ({ kind: "num", value }),
  str: (value: string): Expr => ({ kind: "str", value }),
  bool: (value: boolean): Expr => ({ kind: "bool", value }),
  add: (left: Expr, right: Expr): Expr => ({ kind: "add", left, right }),
  eq: (left: Expr, right: Expr): Expr => ({ kind: "eq", left, right }),
  if: (cond: Expr, then: Expr, otherwise: Expr): Expr => ({
    kind: "if",
    cond,
    then,
    else: otherwise
  })
}

const expr: Parser<Expr> = recursive<Expr>(expr => {
  const atom = located(
    oneOf(
      token(regex(/\d+/)).map(digits => Expr.num(Number(digits))),
      token(regex(/"[^"]*"/)).map(text => Expr.str(text.slice(1, -1))),
      keyword("true").map(() => Expr.bool(true)),
      keyword("false").map(() => Expr.bool(false)),
      between(symbol("("), symbol(")"), expr)
    )
  )

  const conditional = located(
    parser(function*() {
      yield* keyword("if")
      yield* commit()
      const cond = yield* expr
      yield* keyword("then")
      const then = yield* expr
      yield* keyword("else")
      return Expr.if(cond, then, yield* expr)
    })
  )

  const operators = located(
    precedence(atom, [
      { associativity: "left", operators: [[symbol("+"), Expr.add]] },
      { associativity: "left", operators: [[symbol("=="), Expr.eq]] }
    ])
  )

  return oneOf(conditional, operators)
})

const program = expr.zipLeft(spaces).zipLeft(eof)

const str = con("string")

const expect = (expr: Expr, expected: Type, label: string) =>
  infer(expr)
    .flatMap(found => unify(found, expected))
    .context(label)
    .at(expr.span)

const infer = (expr: Expr): Check<Type> => {
  switch (expr.kind) {
    case "num":
      return pure(int)
    case "str":
      return pure(str)
    case "bool":
      return pure(bool)
    case "add":
      return check(function*() {
        const left = yield* infer(expr.left)
        yield* choice(unify(left, int), unify(left, str))
          .context("left operand of +")
          .at(expr.left.span)
        yield* expect(expr.right, left, "right operand of +")
        return left
      })
    case "eq":
      return check(function*() {
        const left = yield* infer(expr.left)
        yield* expect(expr.right, left, "right operand of ==")
        return bool
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

report(program, expr => run(infer(expr)), [
  "1 + 2 == 3",
  "\"type\" + \"rator\"",
  "if 1 + 1 == 2 then \"yes\" else \"no\"",
  "1 + true",
  "\"a\" + 1",
  "true + false",
  "if 1 then 2 else 3",
  "if true then 1 else \"one\""
])
