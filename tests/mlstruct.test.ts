import assert from "node:assert/strict"
import { describe, test } from "node:test"
import {
  attempt,
  bind,
  check,
  choice,
  fail,
  get,
  pure,
  run,
  type Check
} from "typerator"
import {
  env,
  infer as inferExpr,
  prelude,
  typeOf
} from "../examples/mlstruct/infer.ts"
import { program } from "../examples/mlstruct/parser.ts"
import {
  constrain,
  fresh,
  resolve,
  solver
} from "../examples/mlstruct/subtype.ts"
import {
  and,
  bool,
  fn,
  int,
  not,
  or,
  record,
  show,
  tag,
  type Type
} from "../examples/mlstruct/type.ts"

const holds = (found: Type, expected: Type) =>
  run(constrain(found, expected)).success

const shown = (checker: Check<Type>) => {
  const result = run(checker.flatMap(resolve))
  return result.success ? show(result.value) : result.errors[0].message
}

describe("constrain", () => {
  test("records are subtypes when they have the expected fields", () => {
    assert.ok(holds(record([["x", int], ["y", bool]]), record([["x", int]])))
    assert.ok(!holds(record([["y", bool]]), record([["x", int]])))
  })

  test("functions are contravariant in their argument", () => {
    const wide = fn(record([]), int)
    const narrow = fn(record([["x", int]]), int)
    assert.ok(holds(wide, narrow))
    assert.ok(!holds(narrow, wide))
  })

  test("unions, intersections and negations follow set rules", () => {
    assert.ok(holds(int, or(int, bool)))
    assert.ok(holds(and(tag("A"), record([["x", int]])), tag("A")))
    assert.ok(holds(tag("A"), not(tag("B"))))
    assert.ok(!holds(tag("A"), not(tag("A"))))
    assert.ok(holds(and(int, bool), tag("Anything")))
  })

  test("variables collect bounds that later constraints must respect", () => {
    const type = check(function*() {
      const a = yield* fresh()
      yield* constrain(int, a)
      yield* constrain(a, or(int, bool))
      return a
    })
    assert.equal(shown(type), "int")
    const broken = check(function*() {
      const a = yield* fresh()
      yield* constrain(a, int)
      yield* constrain(bool, a)
      return a
    })
    assert.equal(shown(broken), "Expected int, found bool")
  })
})

describe("solver rollback", () => {
  test("a failed expectation retains successful operand inference", () => {
    const parsed = program.parse("fun x -> if x + 1 then 1 else 0")
    assert.ok(parsed.success)
    const result = run(bind(
      env,
      prelude,
      check(function*() {
        const type = yield* inferExpr(parsed.value)
        assert.equal(show(yield* resolve(type)), "int -> int")
      })
    ))
    assert.equal(result.success, false)
    if (!result.success) {
      assert.deepEqual(result.errors.map(error => error.message), [
        "Expected bool, found int"
      ])
    }
  })

  test("nested attempts preserve bounds aliases and discard new entries", () => {
    const result = run(check(function*() {
      const state = yield* get(solver)
      const map = state.bounds
      const a = yield* fresh()
      yield* constrain(int, a)
      const bounds = state.bounds.get(a.id)!
      const lower = bounds.lower
      const upper = bounds.upper
      const next = state.next
      const outer = yield* choice(
        attempt(check(function*() {
          yield* constrain(a, or(int, bool))
          const outerUpper = [...upper]
          const inner = yield* choice(
            attempt(check(function*() {
              const b = yield* fresh()
              yield* constrain(int, b)
              assert.equal(map.size, 2)
              yield* constrain(bool, a)
              return yield* fail("inner")
            })),
            pure(false)
          )
          assert.equal(inner, false)
          assert.equal(state.bounds, map)
          assert.equal(state.bounds.get(a.id), bounds)
          assert.equal(bounds.lower, lower)
          assert.equal(bounds.upper, upper)
          assert.deepEqual(lower, [int])
          assert.deepEqual(upper, outerUpper)
          assert.equal(state.next, next)
          assert.equal(map.size, 1)
          return yield* fail("outer")
        })),
        pure(false)
      )
      assert.equal(outer, false)
      assert.equal(state.bounds.get(a.id), bounds)
      assert.equal(bounds.lower, lower)
      assert.equal(bounds.upper, upper)
      assert.deepEqual(lower, [int])
      assert.deepEqual(upper, [])
      assert.equal(state.next, next)
      yield* constrain(a, int)
      assert.equal(show(yield* resolve(a)), "int")
    }))
    assert.equal(result.success, true)
  })

  test("a failed compound constraint is atomic", () => {
    const result = run(check(function*() {
      const state = yield* get(solver)
      const a = yield* fresh()
      yield* constrain(int, a)
      const bounds = state.bounds.get(a.id)!
      const lower = bounds.lower
      const upper = bounds.upper
      yield* constrain(
        record([["x", a], ["y", bool]]),
        record([["x", int], ["y", int]])
      ).recover()
      assert.equal(state.bounds.get(a.id), bounds)
      assert.equal(bounds.lower, lower)
      assert.equal(bounds.upper, upper)
      assert.deepEqual(lower, [int])
      assert.deepEqual(upper, [])
    }))
    assert.equal(result.success, false)
    if (!result.success) {
      assert.deepEqual(result.errors.map(error => error.message), [
        "Expected int, found bool"
      ])
    }
  })

  test("attempt rolls back recovered diagnostics through existing aliases", () => {
    const result = run(check(function*() {
      const state = yield* get(solver)
      const a = yield* fresh()
      yield* constrain(int, a)
      const bounds = state.bounds.get(a.id)!
      const upper = bounds.upper
      const attempted = yield* choice(
        attempt(check(function*() {
          yield* constrain(a, int)
          yield* fail("recovered").recover()
          return true
        })),
        pure(false)
      )
      assert.equal(attempted, false)
      assert.equal(state.bounds.get(a.id), bounds)
      assert.equal(bounds.upper, upper)
      assert.deepEqual(upper, [])
    }))
    assert.equal(result.success, true)
  })
})

const infer = (source: string) => {
  const parsed = program.parse(source)
  assert.ok(parsed.success, `failed to parse ${source}`)
  const result = typeOf(parsed.value)
  return result.success
    ? show(result.value)
    : result.errors.map(error => error.message).join("; ")
}

const cases: readonly [string, string][] = [
  ["fun x -> x", "'a -> 'a"],
  ["fun x -> { a = x, b = x.f }", "'a & { f : 'b } -> { a : 'a, b : 'b }"],
  ["fun b -> if b then 1 else true", "bool -> int | bool"],
  ["Some { value = 1 }", "Some & { value : int }"],
  [
    "fun x -> if x is Some then x.value else 0",
    "{ value : 'a } | ~Some -> 'a | int"
  ],
  ["fun x -> if x is Some then x else None", "'a | ~Some -> 'a | None"],
  ["let id = fun x -> x in { a = id 1, b = id true }", "{ a : int, b : bool }"],
  [
    "let get = fun x -> if x is Some then x.value else 0 in get None",
    "int"
  ],
  ["fun x -> x x", "'a & ('a -> 'b) -> 'b"],
  [
    "(fun x -> if x is Some then x.value else 0) (Some {})",
    "Expected { value : 'a }, found Some"
  ],
  ["(fun r -> r.x + 1) { y = 2 }", "Expected { x : 'a }, found { y : int }"]
]

for (const [source, expected] of cases) {
  test(source, () => assert.equal(infer(source), expected))
}
