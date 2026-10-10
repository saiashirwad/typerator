import { report } from "../report.ts"
import { typeOf } from "./infer.ts"
import { program } from "./parser.ts"

report(program, typeOf, [
  "let rec fact = fun n -> if n == 0 then 1 else n * fact (n - 1) in fact 5",
  `let rec count = fun n ->
  if n == 0 then 0 else 1 + count (n - 1)
in count`,
  "let rec loop = fun x -> loop x in loop",
  "let rec f = fun n -> f true + n in f"
])
