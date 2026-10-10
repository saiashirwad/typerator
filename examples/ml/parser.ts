import {
  between,
  choice,
  commit,
  eof,
  many,
  parser,
  postfix,
  precedence,
  recursive,
  regex,
  sepBy,
  type Parser
} from "parserator"
import {
  identifier,
  keyword,
  located,
  spaces,
  symbol,
  token
} from "../lexer.ts"
import { Expr } from "./syntax.ts"

const name = identifier([
  "let",
  "in",
  "fun",
  "if",
  "then",
  "else",
  "true",
  "false"
])

const call = (func: string) => (left: Expr, right: Expr) =>
  Expr.app(Expr.var(func), left, right)

const expr: Parser<Expr> = recursive<Expr>(expr => {
  const field = parser(function*() {
    const label = yield* name
    yield* symbol("=")
    return [label, yield* expr] as const
  })

  const atom = located(
    choice(
      token(regex(/\d+/)).map(digits => Expr.lit(Number(digits))),
      keyword("true").map(() => Expr.lit(true)),
      keyword("false").map(() => Expr.lit(false)),
      name.map(Expr.var),
      between(symbol("("), symbol(")"), expr),
      between(symbol("{"), symbol("}"), sepBy(field, symbol(","))).map(
        Expr.record
      )
    )
  )

  const selection = located(
    postfix(
      atom,
      symbol(".").zipRight(name).map(label => (record: Expr) =>
        Expr.field(record, label)
      )
    )
  )

  const application = located(
    parser(function*() {
      const func = yield* selection
      const args = yield* many(selection)
      return Expr.app(func, ...args)
    })
  )

  const operators = located(
    precedence(application, [
      { associativity: "left", operators: [[symbol("+"), call("add")]] },
      { associativity: "left", operators: [[symbol("=="), call("eq")]] }
    ])
  )

  const lambda = located(
    parser(function*() {
      yield* keyword("fun")
      yield* commit()
      const param = yield* name
      yield* symbol("->")
      return Expr.lam(param, yield* expr)
    })
  )

  const binding = located(
    parser(function*() {
      yield* keyword("let")
      yield* commit()
      const id = yield* name
      yield* symbol("=")
      const value = yield* expr
      yield* keyword("in")
      return Expr.let(id, value, yield* expr)
    })
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

  return choice(lambda, binding, conditional, operators)
})

export const program = expr.zipLeft(spaces).zipLeft(eof)
