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
  current => {
    const saved = [...current]
    return () => {
      current.clear()
      for (const [name, value] of saved) current.set(name, value)
    }
  }
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
    const result = run(check(function*() {
      const a = yield* pure(1)
      const b = yield* pure(2)
      return a + b
    }))
    assert.deepEqual(result, { success: true, value: 3 })
  })

  test("stops at the first failure", () => {
    const seen: number[] = []
    const result = run(check(function*() {
      seen.push(1)
      yield* fail("boom")
      seen.push(2)
    }))
    assert.equal(result.success, false)
    assert.deepEqual(seen, [1])
  })

  test("closes abandoned generators so finally runs", () => {
    let closed = 0
    const checker = check(function*() {
      try {
        yield* fail("boom")
      } finally {
        closed++
      }
    })
    run(checker)
    run(checker)
    assert.equal(closed, 2)
  })

  test("programming exceptions propagate and still close the generator", () => {
    const error = new Error("bug")
    let closed = false
    const checker = check(function*() {
      try {
        yield* pure(1).map(() => {
          throw error
        })
      } finally {
        closed = true
      }
    })
    assert.throws(() => run(checker), value => value === error)
    assert.equal(closed, true)
  })

  test("yielding checks during cleanup is rejected", () => {
    const checker = check(function*() {
      try {
        yield* fail("boom")
      } finally {
        yield* pure(undefined)
      }
    })
    assert.throws(
      () => run(checker),
      /cannot be yielded during generator cleanup/
    )
  })
})

describe("combinators", () => {
  test("map transforms the value", () => {
    assert.deepEqual(run(pure(2).map(n => n * 3)), { success: true, value: 6 })
  })

  test("flatMap chains checks", () => {
    assert.deepEqual(run(assign("a", "int").flatMap(() => valueOf("a"))), {
      success: true,
      value: "int"
    })
  })

  test("sequence collects values as a tuple", () => {
    assert.deepEqual(run(sequence([pure(1), pure("two"), pure(true)])), {
      success: true,
      value: [1, "two", true]
    })
  })

  test("sequence stops at the first failure", () => {
    const result = run(sequence([pure(1), fail("boom"), pure(3)]))
    assert.equal(!result.success && result.errors[0].message, "boom")
  })
})

describe("state", () => {
  const counter = state(() => ({ count: 0 }), current => {
    const count = current.count
    return () => {
      current.count = count
    }
  })
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

  test("the same check runs with fresh state every time", () => {
    assert.deepEqual(run(tick), { success: true, value: 1 })
    assert.deepEqual(run(tick), { success: true, value: 1 })
  })

  test("rollback restores containers without replacing retained references", () => {
    const result = run(check(function*() {
      const alias = yield* get(bindings)
      alias.set("before", "int")
      yield* choice(
        check(function*() {
          yield* assign("during", "bool")
          yield* fail("no")
        }),
        pure(undefined)
      )
      assert.equal(yield* get(bindings), alias)
      return [...alias]
    }))
    assert.deepEqual(result, { success: true, value: [["before", "int"]] })
  })
})

describe("backtracking and atomicity", () => {
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

  test("choice permits heterogeneous values", () => {
    assert.deepEqual(run(choice(fail("no"), pure("two"), pure(3))), {
      success: true,
      value: "two"
    })
  })

  test("atomic rolls back a failure and preserves its original diagnostic", () => {
    const result = run(check(function*() {
      const alias = yield* get(bindings)
      yield* check(function*() {
        yield* assign("x", "int")
        yield* fail("boom").context("inner").at({ start: 1, end: 2 })
      }).atomic().context("outer").recover()
      assert.equal(alias.size, 0)
    }))
    assert.deepEqual(!result.success && result.errors[0], {
      message: "boom",
      context: ["inner", "outer"],
      span: { start: 1, end: 2 }
    })
  })

  test("atomic restores state before propagating a programming exception", () => {
    const error = new Error("bug")
    let alias: Map<string, string> | undefined
    const checker = check(function*() {
      alias = yield* get(bindings)
      yield* check(function*() {
        yield* assign("x", "int")
        throw error
      }).atomic()
    })
    assert.throws(() => run(checker), value => value === error)
    assert.equal(alias?.size, 0)
  })
})

describe("recovery", () => {
  const messages = <A>(checker: Check<A>) => {
    const result = run(checker)
    return result.success ? [] : result.errors.map(error => error.message)
  }

  test("recover records the error and keeps checking", () => {
    assert.deepEqual(
      messages(check(function*() {
        yield* fail("first").recover()
        yield* fail("second").recover()
        yield* fail("third")
      })),
      ["first", "second", "third"]
    )
  })

  test("recover continues with the fallback value", () => {
    assert.deepEqual(
      messages(check(function*() {
        const value = yield* fail("boom").recover(pure(5))
        assert.equal(value, 5)
      })),
      ["boom"]
    )
  })

  test("choice skips alternatives that recovered from an error", () => {
    assert.deepEqual(run(choice(fail("boom").recover(), pure(undefined))), {
      success: true,
      value: undefined
    })
  })

  test("recovery retains successful work; atomic defines the rollback boundary", () => {
    const result = run(check(function*() {
      yield* check(function*() {
        yield* assign("x", "int")
        yield* fail("boom")
      }).recover()
      assert.equal(yield* valueOf("x"), "int")
    }))
    assert.equal(result.success, false)
  })

  test("atomic commits recovered work while attempt rejects it", () => {
    const body = check(function*() {
      yield* assign("x", "int")
      yield* fail("recovered").recover()
    })
    const committed = run(check(function*() {
      yield* body.atomic()
      assert.equal(yield* valueOf("x"), "int")
    }))
    assert.equal(committed.success, false)
    const rejected = run(check(function*() {
      yield* choice(body, pure(undefined))
      return yield* valueOf("x")
    }))
    assert.deepEqual(rejected, { success: true, value: undefined })
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

  test("outer annotations apply to errors recovered inside the body", () => {
    const result = run(
      check(function*() {
        yield* fail("boom").context("inner").recover()
      }).context("outer").at({ start: 1, end: 2 })
    )
    assert.deepEqual(!result.success && result.errors[0], {
      message: "boom",
      context: ["inner", "outer"],
      span: { start: 1, end: 2 }
    })
  })

  test("annotation scopes do not leak into following steps", () => {
    const result = run(check(function*() {
      yield* fail("one").at({ start: 1, end: 2 }).context("inside").recover()
      yield* fail("two").at(undefined).recover()
    }))
    assert.deepEqual(!result.success && result.errors, [
      { message: "one", context: ["inside"], span: { start: 1, end: 2 } },
      { message: "two", context: [] }
    ])
  })

  test("render points at the span with surrounding lines", () => {
    const output = render(
      { message: "boom", span: { start: 23, end: 27 }, context: ["x", "y"] },
      "let a = 1 in\nlet b = a true in\nb"
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
