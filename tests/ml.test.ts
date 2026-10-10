import assert from "node:assert/strict"
import { describe, test } from "node:test"
import {
  attempt,
  bind,
  check,
  get,
  run,
  type Check,
  type Result
} from "typerator"
import { infer as inferExpr, prelude, typeOf } from "../examples/ml/infer.ts"
import { program } from "../examples/ml/parser.ts"
import {
  bool,
  con,
  fn,
  int,
  mono,
  record,
  show,
  tvar,
  type Type
} from "../examples/ml/type.ts"
import {
  env,
  fresh,
  generalize,
  instantiate,
  resolve,
  solution,
  unify
} from "../examples/ml/unify.ts"

const resolved = (checker: Check<Type>) => run(checker.flatMap(resolve))

const shown = (result: Result<Type>) =>
  result.success ? show(result.value) : result.errors[0].message

const parse = (source: string) => {
  const parsed = program.parse(source)
  assert.ok(parsed.success, `failed to parse ${source}`)
  return parsed.value
}

const infer = (source: string) => {
  const result = typeOf(parse(source))
  return result.success
    ? show(result.value)
    : result.errors.map(error => error.message).join("; ")
}

describe("unify", () => {
  test("solves type variables", () => {
    const result = resolved(check(function*() {
      const a = yield* fresh()
      yield* unify(fn(a, a), fn(int, tvar(99)))
      return tvar(99)
    }))
    assert.equal(shown(result), "int")
  })

  test("reports mismatched constructors", () => {
    const result = run(unify(fn(int, int), fn(bool, int)))
    assert.equal(result.success, false)
    assert.equal(
      !result.success && result.errors[0].message,
      "Expected bool -> int, found int -> int"
    )
  })

  test("rejects infinite types", () => {
    const result = run(check(function*() {
      const a = yield* fresh()
      yield* unify(a, fn(a, int))
    }))
    assert.equal(
      !result.success && result.errors[0].message,
      "Infinite type: 'a occurs in 'a -> int"
    )
  })

  test("compares argument counts", () => {
    const result = run(unify(con("pair", int, int), con("pair", int)))
    assert.equal(result.success, false)
  })

  test("failed unification rolls back partial bindings without replacing aliases", () => {
    const result = run(check(function*() {
      const current = yield* get(solution)
      const subst = current.subst
      const a = yield* fresh()
      yield* unify(fn(a, int), fn(bool, bool)).recover()
      assert.equal(yield* get(solution), current)
      assert.equal(current.subst, subst)
      assert.equal(subst.size, 0)
      assert.equal(current.next, 1)
      assert.deepEqual(yield* resolve(a), a)
    }))
    assert.equal(result.success, false)
  })

  test("failed row unification restores allocated variables and bindings", () => {
    const result = run(check(function*() {
      const current = yield* get(solution)
      const rest = yield* fresh()
      const subst = current.subst
      yield* unify(record([["x", int]], rest), record([["y", bool]], rest))
        .recover()
      assert.equal(current.subst, subst)
      assert.equal(subst.size, 0)
      assert.equal(current.next, 1)
      assert.deepEqual(yield* resolve(rest), rest)
    }))
    assert.equal(result.success, false)
  })

  test("attempt rolls back recovered inference diagnostics", () => {
    const result = run(check(function*() {
      const current = yield* get(solution)
      const subst = current.subst
      const fallback = yield* attempt(
        bind(env, prelude, inferExpr(parse("fun x -> x + true")))
      ).recover(fresh())
      assert.deepEqual(fallback, tvar(0))
      assert.equal(current.next, 1)
      assert.equal(current.subst, subst)
      assert.equal(subst.size, 0)
    }))
    assert.equal(result.success, false)
    if (!result.success) {
      assert.equal(result.errors.length, 1)
      assert.equal(result.errors[0].message, "Expected int, found bool")
    }
  })
})

describe("records", () => {
  test("field order does not matter", () => {
    const result = resolved(check(function*() {
      const a = yield* fresh()
      yield* unify(
        record([["x", int], ["y", bool]]),
        record([["y", a], ["x", int]])
      )
      return a
    }))
    assert.equal(shown(result), "bool")
  })

  test("an open record picks up the fields it is missing", () => {
    const result = resolved(check(function*() {
      const rest = yield* fresh()
      yield* unify(
        record([["x", int]], rest),
        record([["x", int], ["y", bool]])
      )
      return record([], rest)
    }))
    assert.equal(shown(result), "{ y : bool }")
  })

  test("closed records must have the same fields", () => {
    const missing = run(unify(record([["x", int]]), record([["y", int]])))
    const extra = run(
      unify(record([["x", int], ["y", int]]), record([["x", int]]))
    )
    assert.equal(
      !missing.success && missing.errors[0].message,
      "Expected { y : int }, found { x : int }"
    )
    assert.equal(extra.success, false)
  })

  test("rows sharing a tail cannot gain different fields", () => {
    const result = run(check(function*() {
      const rest = yield* fresh()
      yield* unify(record([["x", int]], rest), record([["y", int]], rest))
    }))
    assert.match(
      !result.success ? result.errors[0].message : "",
      /^Infinite type/
    )
  })

  test("show prints open and closed records", () => {
    assert.equal(
      show(record([["x", int], ["y", bool]])),
      "{ x : int, y : bool }"
    )
    assert.equal(show(record([["x", int]], tvar(7))), "{ x : int | 'a }")
    assert.equal(show(record([])), "{}")
    assert.equal(
      show(record(new Map([["__proto__", int]]))),
      "{ __proto__ : int }"
    )
    assert.equal(show(record([["__proto__", bool]])), "{ __proto__ : bool }")
  })
})

describe("environment", () => {
  test("generalize keeps variables bound in the environment", () => {
    const result = run(check(function*() {
      const a = yield* fresh()
      const b = yield* fresh()
      return yield* bind(env, [["x", mono(a)]], generalize(fn(a, b)))
    }))
    assert.deepEqual(result.success && result.value.vars, [1])
  })

  test("instantiate gives each use fresh variables", () => {
    const result = resolved(check(function*() {
      const scheme = { vars: [0], type: fn(tvar(0), tvar(0)) }
      const first = yield* instantiate(scheme)
      const second = yield* instantiate(scheme)
      yield* unify(first, fn(int, int))
      yield* unify(second, fn(bool, bool))
      return second
    }))
    assert.equal(shown(result), "bool -> bool")
  })

  test("fresh variables do not collide with free variables in globals", () => {
    const globals = new Map([["external", mono(tvar(0))]])
    const result = typeOf(parse("fun x -> external"), globals)
    assert.equal(shown(result), "'a -> 'b")
    assert.deepEqual(globals.get("external"), mono(tvar(0)))
    const mixed = new Map([["external", {
      vars: [0],
      type: fn(tvar(0), tvar(20))
    }]])
    assert.equal(shown(typeOf(parse("fun x -> external x"), mixed)), "'a -> 'b")
  })

  test("lexical bindings do not leak into globals or siblings", () => {
    const globals = new Map(prelude)
    assert.equal(shown(typeOf(parse("let x = true in x"), globals)), "bool")
    assert.equal(globals.has("x"), false)
    assert.equal(infer("{ a = (fun x -> x) 1, b = x }"), "Unbound variable: x")
  })
})

test("failed expectations retain constraints inferred in the operand", () => {
  assert.equal(
    infer("fun f -> let x = (f 1 : bool -> int) in f true"),
    "Expected int, found bool"
  )
  assert.equal(
    infer("fun f -> let x = (if true then f 1 else 0 : bool) in f true"),
    "Expected bool, found int; Expected int, found bool"
  )
})

test("recovered errors keep nested contexts and source locations", () => {
  const result = typeOf(parse("let f = fun x -> x + true in f false"))
  assert.equal(result.success, false)
  if (result.success) return
  assert.equal(result.errors.length, 2)
  assert.deepEqual(result.errors[0].context, ["function argument", "let f"])
  assert.deepEqual(result.errors[1]?.context, ["function argument"])
  assert.ok(result.errors.every(error => error.span !== undefined))
})

const cases: readonly [string, string][] = [
  ["fun x -> x", "'a -> 'a"],
  ["fun x -> x + 1", "int -> int"],
  [
    "fun f -> fun g -> fun x -> f (g x)",
    "('a -> 'b) -> ('c -> 'a) -> 'c -> 'b"
  ],
  ["let id = fun x -> x in if id true then id 1 else 0", "int"],
  ["fun x -> x + 1 == true", "Expected int, found bool"],
  ["fun x -> x x", "Infinite type: 'a occurs in 'a -> 'b"],
  ["fun f -> let a = f 1 in f true", "Expected int, found bool"],
  ["missing", "Unbound variable: missing"],
  ["fun r -> r.x", "{ x : 'a | 'b } -> 'a"],
  ["(fun r -> r.x) { x = 1, y = true }", "int"],
  [
    "let get = fun r -> r.name in get { name = 1, age = 2 } + get { name = 3 }",
    "int"
  ],
  [
    "(fun r -> r.x + 1) { y = 2 }",
    "Expected { x : int | 'a }, found { y : int }"
  ],
  [
    "let rec fact = fun n -> if n == 0 then 1 else n * fact (n - 1) in fact",
    "int -> int"
  ],
  ["let rec loop = fun x -> loop x in loop", "'a -> 'b"],
  ["(fun x -> x : 'a -> 'a)", "'a -> 'a"],
  ["(fun r -> r.x : { x : int } -> int)", "{ x : int } -> int"],
  ["(true : int)", "Expected int, found bool"],
  ["(1 : string)", "Unknown type string"],
  [
    "let f = fun x -> x + true in f false",
    "Expected int, found bool; Expected int, found bool"
  ],
  ["{ __proto__ = 1, constructor = true, toString = 2 }.__proto__", "int"],
  ["({ __proto__ = true } : { __proto__ : bool }).__proto__", "bool"],
  ["let __proto__ = 1 in __proto__", "int"],
  ["constructor", "Unbound variable: constructor"]
]

for (const [source, expected] of cases) {
  test(source, () => assert.equal(infer(source), expected))
}
