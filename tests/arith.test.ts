import assert from "node:assert/strict"
import { test } from "node:test"
import { program, typeOf } from "../examples/arith.ts"

const cases: readonly [string, string][] = [
  ["1 + 2 == 3", "bool"],
  ["\"type\" + \"rator\"", "string"],
  ["if 1 + 1 == 2 then \"yes\" else \"no\"", "string"],
  ["1 + true", "Expected int, found bool"],
  ["\"a\" + 1", "Expected string, found int"],
  ["true + false", "Expected int, found bool"],
  ["if 1 then 2 else 3", "Expected bool, found int"],
  ["if true then 1 else \"one\"", "Expected int, found string"],
  [
    "if 1 then 2 else \"one\"",
    "Expected bool, found int; Expected int, found string"
  ]
]

for (const [source, expected] of cases) {
  test(source, () => {
    const parsed = program.parse(source)
    assert.ok(parsed.success)
    const result = typeOf(parsed.value)
    assert.equal(
      result.success
        ? result.value
        : result.errors.map(error => error.message).join("; "),
      expected
    )
  })
}

test("arithmetic diagnostics include operand context and source spans", () => {
  const parsed = program.parse("1 + true")
  assert.ok(parsed.success)
  const result = typeOf(parsed.value)
  assert.ok(!result.success)
  assert.deepEqual(result.errors[0], {
    message: "Expected int, found bool",
    context: ["right operand of +"],
    span: { start: 4, end: 8 }
  })
})
