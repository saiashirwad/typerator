import { show } from "typerator/unify"
import { report } from "../report.ts"
import { typeOf } from "./infer.ts"
import { program } from "./parser.ts"

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
