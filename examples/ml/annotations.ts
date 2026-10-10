import { show } from "typerator/unify"
import { report } from "../report.ts"
import { typeOf } from "./infer.ts"
import { program } from "./parser.ts"

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
