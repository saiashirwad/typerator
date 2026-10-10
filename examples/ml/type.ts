export type Type =
  | { readonly kind: "var"; readonly id: number }
  | {
    readonly kind: "con"
    readonly name: string
    readonly args: readonly Type[]
  }
  | {
    readonly kind: "row"
    readonly label: string
    readonly type: Type
    readonly rest: Type
  }

export type Scheme = {
  readonly vars: readonly number[]
  readonly type: Type
}

export const tvar = (id: number): Type => ({ kind: "var", id })

export const con = (name: string, ...args: readonly Type[]): Type => ({
  kind: "con",
  name,
  args
})

export const fn = (from: Type, to: Type): Type => con("->", from, to)

export const int = con("int")

export const bool = con("bool")

export const empty = con("{}")

export const extend = (label: string, type: Type, rest: Type): Type => ({
  kind: "row",
  label,
  type,
  rest
})

export const record = (
  fields: Iterable<readonly [string, Type]>,
  rest: Type = empty
): Type =>
  con(
    "record",
    [...fields].reduceRight(
      (row, [label, type]) => extend(label, type, row),
      rest
    )
  )

export const mono = (type: Type): Scheme => ({ vars: [], type })

export const free = (type: Type): number[] => {
  switch (type.kind) {
    case "var":
      return [type.id]
    case "con":
      return type.args.flatMap(free)
    case "row":
      return [...free(type.type), ...free(type.rest)]
  }
}

const isFn = (type: Type) => type.kind === "con" && type.name === "->"

const atom = (type: Type, names: Map<number, string>) =>
  isFn(type) ? `(${show(type, names)})` : show(type, names)

const showRow = (row: Type, names: Map<number, string>) => {
  const fields: string[] = []
  let rest = row
  while (rest.kind === "row") {
    fields.push(`${rest.label} : ${show(rest.type, names)}`)
    rest = rest.rest
  }
  const tail = rest.kind === "var" ? [show(rest, names)] : []
  const body = [fields.join(", "), ...tail].filter(Boolean).join(" | ")
  return body ? `{ ${body} }` : "{}"
}

export const show = (type: Type, names = new Map<number, string>()): string => {
  if (type.kind === "var") {
    const name = names.get(type.id)
      ?? `'${String.fromCharCode(97 + names.size)}`
    names.set(type.id, name)
    return name
  }
  if (type.kind === "row") return showRow(type, names)
  const [from, to] = type.args
  if (type.name === "record" && from) return showRow(from, names)
  if (isFn(type) && from && to) {
    return `${atom(from, names)} -> ${show(to, names)}`
  }
  const args = type.args.map(arg => atom(arg, names))
  if (args.length === 0) return type.name
  return args.length === 1
    ? `${args.join("")} ${type.name}`
    : `(${args.join(", ")}) ${type.name}`
}
