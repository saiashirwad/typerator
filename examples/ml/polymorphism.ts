import { show } from "typerator/unify"
import { report } from "../report.ts"
import { typeOf } from "./infer.ts"
import { program } from "./parser.ts"

report(program, typeOf, show, [
  "fun x -> x",
  "fun x -> x + 1",
  "fun f -> fun g -> fun x -> f (g x)",
  "let id = fun x -> x in if id true then id 1 else 0",
  `let twice = fun f -> fun x -> f (f x) in
let inc = fun n -> n + 1 in
twice inc 40`
])
