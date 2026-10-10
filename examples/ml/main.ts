import { report } from "../report.ts"
import { prelude, typeOf } from "./infer.ts"
import { program } from "./parser.ts"
import { con, fn, show, tvar, type Type } from "./type.ts"
import type { Env } from "./unify.ts"

report(program, typeOf, show, [
  "fun x -> x",
  "fun x -> x + 1",
  "fun f -> fun g -> fun x -> f (g x)",
  "let id = fun x -> x in if id true then id 1 else 0",
  `let twice = fun f -> fun x -> f (f x) in
let inc = fun n -> n + 1 in
twice inc 40`
])

report(program, typeOf, show, [
  "(fun x -> x + 1) true",
  "if 1 + 2 then 3 else 4",
  "if true then 10 else false",
  "fun x -> x x",
  "missing 1",
  "1 2",
  "fun f -> let a = f 1 in f true",
  `let inc = fun n -> n + 1 in
let flag = inc 1 == 2 in
inc flag`,
  "let f = fun x -> x + true in f false",
  "let x = 1 x",
  "fun -> 1"
])

const list = (item: Type) => con("list", item)
const pair = (first: Type, second: Type) => con("pair", first, second)

const a = tvar(0)
const b = tvar(1)

const env: Env = new Map([
  ...prelude,
  ["nil", { vars: [0], type: list(a) }],
  ["cons", { vars: [0], type: fn(a, fn(list(a), list(a))) }],
  ["map", { vars: [0, 1], type: fn(fn(a, b), fn(list(a), list(b))) }],
  ["pair", { vars: [0, 1], type: fn(a, fn(b, pair(a, b))) }]
])

report(program, expr => typeOf(expr, env), show, [
  "nil",
  "cons 1 (cons 2 nil)",
  "map (fun n -> n == 0) (cons 1 (cons 2 nil))",
  "map (fun n -> pair n true) (cons 1 nil)",
  "cons true (cons 1 nil)"
])

report(program, typeOf, show, [
  "{ x = 1, y = true }",
  "fun r -> r.x",
  "fun r -> r.x + r.y",
  "fun p -> if p.ok then p.value else 0",
  "(fun r -> r.x) { x = 1, y = true }",
  "let get = fun r -> r.name in get { name = 1, age = 2 } + get { name = 3 }",
  "{ point = { x = 1, y = 2 } }.point.y",
  "(fun r -> r.x + 1) { y = 2 }",
  "fun r -> r.x + 1 == r.x"
])

report(program, typeOf, show, [
  "let rec fact = fun n -> if n == 0 then 1 else n * fact (n - 1) in fact 5",
  `let rec count = fun n ->
  if n == 0 then 0 else 1 + count (n - 1)
in count`,
  "let rec loop = fun x -> loop x in loop",
  "let rec f = fun n -> f true + n in f"
])

report(program, typeOf, show, [
  "(1 : int)",
  "fun x -> (x : int)",
  "(fun x -> x : 'a -> 'a)",
  "(fun f -> fun x -> f x : ('a -> 'b) -> 'a -> 'b)",
  "(fun r -> r.x : { x : int } -> int)",
  "(true : int)",
  "(fun x -> x + 1 : int -> bool)",
  "(1 : string)"
])
