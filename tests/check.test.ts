import assert from "node:assert/strict"
import { describe, test } from "node:test"
import {
  Check,
  Reply,
  attempt,
  check,
  choice,
  fail,
  pure,
  render,
  run,
  scoped,
  sequence,
  state,
  within,
  type Result
} from "typerator"
import {
  bool,
  con,
  fn,
  fresh,
  generalize,
  instantiate,
  int,
  local,
  lookup,
  mono,
  record,
  resolve,
  show,
  tvar,
  unify,
  type Type
} from "typerator/unify"

const typeOf = (checker: Check<Type>) =>
  run(
    check(function*() {
      return yield* resolve(yield* checker)
    })
  )

const shown = (result: Result<Type>) =>
  result.success ? show(result.value) : result.errors[0].message

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
    assert.equal(!result.success && result.errors[0].message, "boom")
  })
})

describe("kit state", () => {
  const counter = state(() => ({ count: 0 }), ({ count }) => ({ count }))
  const depth = scoped(0)
  const tick = new Check(scope => Reply.ok(++scope.get(counter).count))
  const current = new Check(scope => Reply.ok(scope.get(depth)))

  test("state persists across steps and attempt restores it", () => {
    const result = run(check(function*() {
      yield* tick
      yield* choice(tick.flatMap(() => fail("boom")), pure(undefined))
      return yield* tick
    }))
    assert.deepEqual(result, { success: true, value: 2 })
  })

  test("within changes a scoped value only for its body", () => {
    const result = run(check(function*() {
      const inside = yield* within(depth, n => n + 1, current)
      return [inside, yield* current]
    }))
    assert.deepEqual(result, { success: true, value: [1, 0] })
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
    assert.equal(!result.success && result.errors[0].message, "first")
  })
})

describe("recovery", () => {
  const messages = <A>(checker: Check<A>) => {
    const result = run(checker)
    return result.success ? [] : result.errors.map(error => error.message)
  }

  test("recover records the error and keeps checking", () => {
    const checker = check(function*() {
      yield* fail("first").recover()
      yield* fail("second").recover()
      yield* fail("third")
    })
    assert.deepEqual(messages(checker), ["first", "second", "third"])
  })

  test("recover continues with the fallback value", () => {
    const checker = check(function*() {
      const value = yield* fail("boom").recover(pure(5))
      if (value !== 5) yield* fail("wrong fallback")
    })
    assert.deepEqual(messages(checker), ["boom"])
  })

  test("choice skips alternatives that recovered from an error", () => {
    const checker = choice(fail("boom").recover(), pure(undefined))
    assert.deepEqual(run(checker), { success: true, value: undefined })
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
})

describe("records", () => {
  test("field order does not matter", () => {
    const result = typeOf(check(function*() {
      const a = yield* fresh()
      yield* unify(record({ x: int, y: bool }), record({ y: a, x: int }))
      return a
    }))
    assert.equal(shown(result), "bool")
  })

  test("an open record picks up the fields it is missing", () => {
    const result = typeOf(check(function*() {
      const rest = yield* fresh()
      yield* unify(record({ x: int }, rest), record({ x: int, y: bool }))
      return record({}, rest)
    }))
    assert.equal(shown(result), "{ y : bool }")
  })

  test("closed records must have the same fields", () => {
    const missing = run(unify(record({ x: int }), record({ y: int })))
    const extra = run(unify(record({ x: int, y: int }), record({ x: int })))
    assert.equal(
      !missing.success && missing.errors[0].message,
      "Expected { y : int }, found { x : int }"
    )
    assert.equal(extra.success, false)
  })

  test("rows sharing a tail cannot gain different fields", () => {
    const result = run(check(function*() {
      const rest = yield* fresh()
      yield* unify(record({ x: int }, rest), record({ y: int }, rest))
    }))
    assert.match(
      !result.success ? result.errors[0].message : "",
      /^Infinite type/
    )
  })

  test("show prints open and closed records", () => {
    assert.equal(show(record({ x: int, y: bool })), "{ x : int, y : bool }")
    assert.equal(show(record({ x: int }, tvar(7))), "{ x : int | 'a }")
    assert.equal(show(record({})), "{}")
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
      !outside.success && outside.errors[0].message,
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
    assert.deepEqual(!result.success && result.errors[0].context, [
      "inner",
      "outer"
    ])
  })

  test("the innermost span wins", () => {
    const result = run(
      fail("boom").at({ start: 1, end: 2 }).at({ start: 0, end: 5 })
    )
    assert.deepEqual(!result.success && result.errors[0].span, {
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
