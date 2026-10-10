import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { check, run, type Check } from "typerator"
import { typeOf } from "../examples/mlstruct/infer.ts"
import { program } from "../examples/mlstruct/parser.ts"
import { constrain, fresh, resolve } from "../examples/mlstruct/subtype.ts"
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
    assert.ok(holds(record({ x: int, y: bool }), record({ x: int })))
    assert.ok(!holds(record({ y: bool }), record({ x: int })))
  })

  test("functions are contravariant in their argument", () => {
    const wide = fn(record({}), int)
    const narrow = fn(record({ x: int }), int)
    assert.ok(holds(wide, narrow))
    assert.ok(!holds(narrow, wide))
  })

  test("unions, intersections and negations follow set rules", () => {
    assert.ok(holds(int, or(int, bool)))
    assert.ok(holds(and(tag("A"), record({ x: int })), tag("A")))
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
