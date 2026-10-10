import { app, lam, let_, lit, report, v } from "./ml.ts"

const id = lam("x", v("x"))
const compose = lam("f", lam("g", lam("x", app(v("f"), app(v("g"), v("x"))))))
const twice = lam("f", lam("x", app(v("f"), app(v("f"), v("x")))))
const inc = lam("n", app(v("add"), v("n"), lit(1)))

report([
  id,
  inc,
  app(inc, lit(41)),
  compose,
  let_("id", id, let_("a", app(v("id"), lit(42)), app(v("id"), lit(true)))),
  let_("twice", twice, app(v("twice"), inc, lit(0)))
])
