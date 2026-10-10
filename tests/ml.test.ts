import assert from "node:assert/strict"
import { test } from "node:test"
import { show } from "typerator/unify"
import { typeOf } from "../examples/ml/infer.ts"
import { program } from "../examples/ml/parser.ts"

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
  ]
]

for (const [source, expected] of cases) {
  test(source, () => assert.equal(infer(source), expected))
}
