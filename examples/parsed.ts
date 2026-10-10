import { render, show } from "typerator"
import { program } from "./ml-parser.ts"
import { typeOf } from "./ml.ts"

const sources = [
  "fun x -> x + 1",
  "let id = fun x -> x in if id true then id 1 else 0",
  `let compose = fun f -> fun g -> fun x -> f (g x) in
let inc = fun n -> n + 1 in
compose inc inc 40`,
  "fun x -> x + 1 == true",
  "if 1 + 2 then 3 else 4",
  `let inc = fun n -> n + 1 in
let flag = inc 1 == 2 in
inc flag`,
  "fun x -> x x",
  "let x = 1 x",
  "fun -> 1"
]

const describe = (source: string) => {
  const parsed = program.parse(source)
  if (!parsed.success) return parsed.error.format()
  const result = typeOf(parsed.value)
  return result.success
    ? `${source}\n  : ${show(result.value)}`
    : render(result.error, source)
}

for (const source of sources) console.log(`${describe(source)}\n`)
