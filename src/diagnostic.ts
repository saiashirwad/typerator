export type Span = { readonly start: number; readonly end: number }

export type Diagnostic = {
  readonly message: string
  readonly span?: Span
  readonly context: readonly string[]
}

const radius = 2

export const render = (diagnostic: Diagnostic, source?: string): string => {
  const context = [...diagnostic.context].reverse().join(" > ")
  const footer = context
    ? [diagnostic.message, `While checking: ${context}`]
    : [diagnostic.message]
  const { span } = diagnostic
  if (source === undefined || span === undefined) return footer.join("\n")
  const lines = source.split("\n")
  const before = source.slice(0, span.start).split("\n")
  const line = before.length
  const column = before.at(-1)?.length ?? 0
  const first = Math.max(1, line - radius)
  const last = Math.min(lines.length, line + radius)
  const width = String(last).length
  const length = (lines[line - 1]?.length ?? 0) - column
  const underline = "^".repeat(
    Math.max(1, Math.min(span.end - span.start, length))
  )
  const gutter = lines.slice(first - 1, last).flatMap((text, index) => {
    const number = first + index
    const marker = number === line ? ">" : " "
    const row = `${marker} ${String(number).padStart(width)} | ${text}`
    return number === line
      ? [row, `  ${" ".repeat(width)} | ${" ".repeat(column)}${underline}`]
      : [row]
  })
  const header = `line ${line}, column ${column + 1}:`
  return [header, ...gutter, ...footer].join("\n")
}
