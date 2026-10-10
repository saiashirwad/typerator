import type { Parser } from "parserator"
import { render, show, type Result, type Type } from "typerator"

export const report = <T>(
  program: Parser<T>,
  typeOf: (node: T) => Result<Type>,
  sources: readonly string[]
) => {
  for (const source of sources) {
    const parsed = program.parse(source)
    if (!parsed.success) {
      console.log(`${parsed.error.format()}\n`)
      continue
    }
    const result = typeOf(parsed.value)
    console.log(
      result.success
        ? `${source}\n  : ${show(result.value)}\n`
        : `${render(result.error, source)}\n`
    )
  }
}
