import assert from "node:assert/strict"
import { describe, test } from "node:test"
import {
  attempt,
  bind,
  check,
  choice,
  fail,
  get,
  lookup,
  pure,
  render,
  run,
  scoped,
  sequence,
  state,
  within,
  type Check
} from "typerator"

const bindings = state(
  () => new Map<string, string>(),
  current => new Map(current)
)

const assign = (name: string, value: string): Check<void> =>
  get(bindings).flatMap(current => {
    const known = current.get(name)
    if (known !== undefined && known !== value) {
      return fail(`${name} is ${known}, not ${value}`)
    }
    current.set(name, value)
    return pure(undefined)
  })

const valueOf = (name: string) =>
  get(bindings).map(current => current.get(name))

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
    const result = run(assign("a", "int").flatMap(() => valueOf("a")))
    assert.deepEqual(result, { success: true, value: "int" })
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

describe("state", () => {
  const counter = state(() => ({ count: 0 }), ({ count }) => ({ count }))
  const depth = scoped(0)
  const tick = get(counter).map(counter => ++counter.count)
  const current = get(depth)

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
    const result = run(check(function*() {
      const tried = attempt(check(function*() {
        yield* assign("a", "int")
        yield* fail("boom")
      }))
      yield* choice(tried, pure(undefined))
      yield* assign("a", "bool")
      return yield* valueOf("a")
    }))
    assert.deepEqual(result, { success: true, value: "bool" })
  })

  test("choice takes the first alternative that succeeds", () => {
    const result = run(check(function*() {
      yield* assign("a", "int")
      yield* choice(
        assign("a", "bool"),
        assign("b", "bool"),
        assign("c", "bool")
      )
      return [yield* valueOf("b"), yield* valueOf("c")]
    }))
    assert.deepEqual(result, { success: true, value: ["bool", undefined] })
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

describe("environment", () => {
  const env = scoped<ReadonlyMap<string, string>>(new Map())

  test("bindings are visible only inside their body", () => {
    const inside = run(bind(env, [["x", "int"]], lookup(env, "x")))
    const outside = run(check(function*() {
      yield* bind(env, [["x", "int"]], pure(undefined))
      return yield* lookup(env, "x")
    }))
    assert.deepEqual(inside, { success: true, value: "int" })
    assert.equal(
      !outside.success && outside.errors[0].message,
      "Unbound variable: x"
    )
  })

  test("several bindings at once, inner ones shadow outer ones", () => {
    const result = run(
      bind(
        env,
        new Map([["x", "int"], ["y", "bool"]]),
        bind(
          env,
          [["x", "string"]],
          sequence([lookup(env, "x"), lookup(env, "y")])
        )
      )
    )
    assert.deepEqual(result, { success: true, value: ["string", "bool"] })
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
