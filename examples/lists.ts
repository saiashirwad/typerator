import { con, fn, tvar, type Env, type Type } from "typerator"
import { app, lam, lit, prelude, report, v } from "./ml.ts"

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

const numbers = app(v("cons"), lit(1), app(v("cons"), lit(2), v("nil")))

report(
  [
    v("nil"),
    numbers,
    app(v("map"), lam("n", app(v("eq"), v("n"), lit(0))), numbers),
    app(v("map"), lam("n", app(v("pair"), v("n"), lit(true))), numbers),
    app(v("cons"), lit(true), numbers)
  ],
  env
)
