export type Type =
  | { readonly kind: "var"; readonly id: number }
  | {
    readonly kind: "con"
    readonly name: string
    readonly args: readonly Type[]
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

export const mono = (type: Type): Scheme => ({ vars: [], type })

export const free = (type: Type): number[] =>
  type.kind === "var" ? [type.id] : type.args.flatMap(free)

const isFn = (type: Type) => type.kind === "con" && type.name === "->"

const atom = (type: Type, names: Map<number, string>) =>
  isFn(type) ? `(${show(type, names)})` : show(type, names)

export const show = (type: Type, names = new Map<number, string>()): string => {
  if (type.kind === "var") {
    const name = names.get(type.id)
      ?? `'${String.fromCharCode(97 + names.size)}`
    names.set(type.id, name)
    return name
  }
  const [from, to] = type.args
  if (isFn(type) && from && to) {
    return `${atom(from, names)} -> ${show(to, names)}`
  }
  const args = type.args.map(arg => atom(arg, names))
  if (args.length === 0) return type.name
  return args.length === 1
    ? `${args.join("")} ${type.name}`
    : `(${args.join(", ")}) ${type.name}`
}
