import type { Span } from "typerator"
import { app, if_, lam, let_, lit, report, v } from "./ml.ts"

const find = (source: string, text: string): Span => {
  const start = source.lastIndexOf(text)
  return { start, end: start + text.length }
}

const inc = lam("x", app(v("add"), v("x"), lit(1)))

report([
  app(inc, { ...lit(true), span: find("(fun x -> add x 1) true", "true") }),
  if_(lit(true), lit(10), {
    ...lit(false),
    span: find("if true then 10 else false", "false")
  }),
  if_({ ...lit(1), span: find("if 1 then 2 else 3", "1") }, lit(2), lit(3)),
  lam("x", app(v("x"), { ...v("x"), span: find("fun x -> x x", "x") })),
  app({ ...v("missing"), span: find("missing 1", "missing") }, lit(1)),
  lam(
    "f",
    let_(
      "a",
      app(v("f"), lit(1)),
      app(v("f"), {
        ...lit(true),
        span: find("fun f -> let a = f 1 in f true", "true")
      })
    )
  ),
  let_(
    "bad",
    app(v("add"), {
      ...lit(true),
      span: find("let bad = add true in bad", "true")
    }),
    v("bad")
  )
])
