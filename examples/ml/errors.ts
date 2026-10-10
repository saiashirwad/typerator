import { report } from "../report.ts"
import { typeOf } from "./infer.ts"
import { program } from "./parser.ts"

report(program, typeOf, [
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
  "let x = 1 x",
  "fun -> 1"
])
