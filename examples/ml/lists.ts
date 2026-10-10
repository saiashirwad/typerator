import { con, fn, tvar, type Env, type Type } from "typerator/unify"
import { report } from "../report.ts"
import { prelude, typeOf } from "./infer.ts"
import { program } from "./parser.ts"

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

report(program, expr => typeOf(expr, env), [
  "nil",
  "cons 1 (cons 2 nil)",
  "map (fun n -> n == 0) (cons 1 (cons 2 nil))",
  "map (fun n -> pair n true) (cons 1 nil)",
  "cons true (cons 1 nil)"
])
