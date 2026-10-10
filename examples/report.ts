import type { Parser } from "parserator"
import { render, type Result } from "typerator"

export const report = <T, V>(
  program: Parser<T>,
  typeOf: (node: T) => Result<V>,
  show: (value: V) => string,
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
        : result.errors.map(error => `${render(error, source)}\n`).join("\n")
    )
  }
}
