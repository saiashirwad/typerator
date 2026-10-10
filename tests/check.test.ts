import assert from "node:assert/strict"
import { describe, test } from "node:test"
import {
  bool,
  check,
  con,
  fail,
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
  tvar,
  unify,
  type Check,
  type Result,
  type Type
} from "typerator"

const typeOf = (checker: Check<Type>) =>
  run(
    check(function*() {
      return yield* resolve(yield* checker)
    })
  )

const shown = (result: Result<Type>) =>
  result.success ? show(result.value) : result.error.message

describe("check", () => {
  test("sequences steps and returns the final value", () => {
    const result = run(
      check(function*() {
        const a = yield* pure(1)
        const b = yield* pure(2)
        return a + b
      })
    )
    assert.deepEqual(result, { success: true, value: 3 })
  })

  test("stops at the first failure", () => {
    const seen: number[] = []
    const result = run(
      check(function*() {
        seen.push(1)
        yield* fail("boom")
        seen.push(2)
      })
    )
    assert.equal(result.success, false)
    assert.deepEqual(seen, [1])
  })
})

describe("unify", () => {
  test("solves type variables", () => {
    const result = typeOf(check(function*() {
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
      !result.success && result.error.message,
      "Expected bool -> int, found int -> int"
    )
  })

  test("rejects infinite types", () => {
    const result = run(check(function*() {
      const a = yield* fresh()
      yield* unify(a, fn(a, int))
    }))
    assert.equal(
      !result.success && result.error.message,
      "Infinite type: 'a occurs in 'a -> int"
    )
  })

  test("compares argument counts", () => {
    const result = run(unify(con("pair", int, int), con("pair", int)))
    assert.equal(result.success, false)
  })
})

describe("environment", () => {
  test("local bindings are visible only inside their body", () => {
    const inside = run(local("x", mono(int), lookup("x")))
    const outside = run(check(function*() {
      yield* local("x", mono(int), pure(undefined))
      return yield* lookup("x")
    }))
    assert.equal(inside.success, true)
    assert.equal(
      !outside.success && outside.error.message,
      "Unbound variable: x"
    )
  })

  test("generalize keeps variables bound in the environment", () => {
    const result = run(check(function*() {
      const a = yield* fresh()
      const b = yield* fresh()
      return yield* local("x", mono(a), generalize(fn(a, b)))
    }))
    assert.deepEqual(result.success && result.value.vars, [1])
  })

  test("instantiate gives each use fresh variables", () => {
    const result = typeOf(check(function*() {
      const scheme = { vars: [0], type: fn(tvar(0), tvar(0)) }
      const first = yield* instantiate(scheme)
      const second = yield* instantiate(scheme)
      yield* unify(first, fn(int, int))
      yield* unify(second, fn(bool, bool))
      return second
    }))
    assert.equal(shown(result), "bool -> bool")
  })
})

describe("diagnostics", () => {
  test("context labels collect innermost first", () => {
    const result = run(fail("boom").context("inner").context("outer"))
    assert.deepEqual(!result.success && result.error.context, [
      "inner",
      "outer"
    ])
  })

  test("the innermost span wins", () => {
    const result = run(
      fail("boom").at({ start: 1, end: 2 }).at({ start: 0, end: 5 })
    )
    assert.deepEqual(!result.success && result.error.span, {
      start: 1,
      end: 2
    })
  })

  test("render points at the span with surrounding lines", () => {
    const source = "let a = 1 in\nlet b = a true in\nb"
    const output = render(
      { message: "boom", span: { start: 23, end: 27 }, context: ["x", "y"] },
      source
    )
    assert.equal(
      output,
      [
        "line 2, column 11:",
        "  1 | let a = 1 in",
        "> 2 | let b = a true in",
        "    |           ^^^^",
        "  3 | b",
        "boom",
        "While checking: y > x"
      ].join("\n")
    )
  })
})
