import {
  between,
  choice,
  commit,
  eof,
  fail,
  literal,
  many,
  notFollowedBy,
  parser,
  precedence,
  recursive,
  regex,
  succeed,
  type Parser
} from "parserator"
import { app, if_, lam, let_, lit, v, type Expr } from "./ml.ts"

const keywords = ["let", "in", "fun", "if", "then", "else", "true", "false"]

const spaces = regex(/\s*/)

const token = <T>(inner: Parser<T>): Parser<T> => spaces.zipRight(inner)

const symbol = (text: string) => token(literal(text))

const keyword = (word: string) =>
  token(literal(word).zipLeft(notFollowedBy(regex(/[\w']/))))

const name = token(
  regex(/[a-z_][\w']*/).flatMap(word =>
    keywords.includes(word) ? fail(`${word} is a keyword`) : succeed(word)
  )
).expected("name")

const located = (inner: Parser<Expr>): Parser<Expr> =>
  spaces.zipRight(inner.withSpan((expr, span) => ({ ...expr, span })))

const call = (func: string) => (left: Expr, right: Expr) =>
  app(v(func), left, right)

const expr: Parser<Expr> = recursive<Expr>(expr => {
  const atom = located(
    choice(
      token(regex(/\d+/)).map(digits => lit(Number(digits))),
      keyword("true").map(() => lit(true)),
      keyword("false").map(() => lit(false)),
      name.map(v),
      between(symbol("("), symbol(")"), expr)
    )
  )

  const application = located(
    parser(function*() {
      const func = yield* atom
      const args = yield* many(atom)
      return app(func, ...args)
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
      return lam(param, yield* expr)
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
      return let_(id, value, yield* expr)
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
      return if_(cond, then, yield* expr)
    })
  )

  return choice(lambda, binding, conditional, operators)
})

export const program = expr.zipLeft(spaces).zipLeft(eof)
