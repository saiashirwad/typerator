import assert from "node:assert/strict"
import { test } from "node:test"
import { show } from "typerator"
import { program } from "../examples/ml-parser.ts"
import { typeOf } from "../examples/ml.ts"

const infer = (source: string) => {
  const parsed = program.parse(source)
  assert.ok(parsed.success, `failed to parse ${source}`)
  const result = typeOf(parsed.value)
  return result.success ? show(result.value) : result.error.message
}

const cases: readonly [string, string][] = [
  ["fun x -> x", "'a -> 'a"],
  ["fun x -> x + 1", "int -> int"],
  [
    "fun f -> fun g -> fun x -> f (g x)",
    "('a -> 'b) -> ('c -> 'a) -> 'c -> 'b"
  ],
  ["let id = fun x -> x in if id true then id 1 else 0", "int"],
  ["fun x -> x + 1 == true", "Cannot unify int with bool"],
  ["fun x -> x x", "Infinite type: 'a occurs in 'a -> 'b"],
  ["fun f -> let a = f 1 in f true", "Cannot unify int with bool"],
  ["missing", "Unbound variable: missing"]
]

for (const [source, expected] of cases) {
  test(source, () => assert.equal(infer(source), expected))
}
