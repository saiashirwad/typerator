import { show } from "typerator/subtype"
import { report } from "../report.ts"
import { typeOf } from "./infer.ts"
import { program } from "./parser.ts"

report(program, typeOf, show, [
  "fun x -> x",
  "fun x -> { a = x, b = x.f }",
  "fun b -> if b then 1 else true",
  "Some { value = 1 }",
  "fun x -> if x is Some then x.value else 0",
  "fun x -> if x is None then 0 else x.value",
  "fun x -> if x is Some then x else None",
  "let get = fun x -> if x is Some then x.value else 0 in get None + get (Some { value = 1 })",
  "let id = fun x -> x in { a = id 1, b = id true }",
  "fun f -> fun x -> f (f x)",
  "(fun x -> x.value) None",
  "(fun r -> r.x + 1) { y = 2 }",
  "1 + true"
])
