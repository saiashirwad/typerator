import assert from "node:assert/strict"
import { describe, test } from "node:test"
import {
  attempt,
  bool,
  check,
  choice,
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
  sequence,
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

describe("combinators", () => {
  test("map transforms the value", () => {
    assert.deepEqual(run(pure(2).map(n => n * 3)), { success: true, value: 6 })
  })

  test("flatMap chains checks", () => {
    const result = typeOf(fresh().flatMap(a => unify(a, int).map(() => a)))
    assert.equal(shown(result), "int")
  })

  test("sequence collects values as a tuple", () => {
    const result = run(sequence([pure(1), pure("two"), pure(true)]))
    assert.deepEqual(result, { success: true, value: [1, "two", true] })
  })

  test("sequence stops at the first failure", () => {
    const result = run(sequence([pure(1), fail("boom"), pure(3)]))
    assert.equal(!result.success && result.error.message, "boom")
  })
})

describe("backtracking", () => {
  test("attempt undoes bindings made before a failure", () => {
    const result = typeOf(check(function*() {
      const a = yield* fresh()
      const tried = attempt(check(function*() {
        yield* unify(a, int)
        yield* fail("boom")
      }))
      yield* choice(tried, pure(undefined))
      yield* unify(a, bool)
      return a
    }))
    assert.equal(shown(result), "bool")
  })

  test("choice takes the first alternative that succeeds", () => {
    const result = typeOf(check(function*() {
      const a = yield* fresh()
      yield* choice(unify(fn(a, a), int), unify(a, bool), unify(a, int))
      return a
    }))
    assert.equal(shown(result), "bool")
  })

  test("choice reports the first error when every alternative fails", () => {
    const result = run(choice(fail("first"), fail("second")))
    assert.equal(!result.success && result.error.message, "first")
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
