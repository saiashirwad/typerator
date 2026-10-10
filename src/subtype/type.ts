export type Type =
  | { readonly kind: "top" }
  | { readonly kind: "bottom" }
  | { readonly kind: "var"; readonly id: number; readonly level: number }
  | { readonly kind: "fn"; readonly from: Type; readonly to: Type }
  | { readonly kind: "record"; readonly fields: ReadonlyMap<string, Type> }
  | { readonly kind: "tag"; readonly name: string }
  | { readonly kind: "and"; readonly types: readonly Type[] }
  | { readonly kind: "or"; readonly types: readonly Type[] }
  | { readonly kind: "not"; readonly type: Type }

export type Scheme = { readonly level: number; readonly type: Type }

export const anything: Type = { kind: "top" }

export const nothing: Type = { kind: "bottom" }

export const tvar = (id: number, level: number): Type => ({
  kind: "var",
  id,
  level
})

export const fn = (from: Type, to: Type): Type => ({ kind: "fn", from, to })

export const record = (
  fields: Readonly<Record<string, Type>> | ReadonlyMap<string, Type>
): Type => ({
  kind: "record",
  fields: fields instanceof Map ? fields : new Map(Object.entries(fields))
})

export const tag = (name: string): Type => ({ kind: "tag", name })

export const int = tag("int")

export const bool = tag("bool")

export const mono = (type: Type): Scheme => ({ level: Infinity, type })

export const key = (type: Type): string => {
  switch (type.kind) {
    case "top":
      return "anything"
    case "bottom":
      return "nothing"
    case "var":
      return `'${type.id}`
    case "fn":
      return `(${key(type.from)} -> ${key(type.to)})`
    case "record":
      return `{${[...type.fields].map(([l, t]) => `${l}:${key(t)}`).join(",")}}`
    case "tag":
      return type.name
    case "and":
      return `(${type.types.map(key).join(" & ")})`
    case "or":
      return `(${type.types.map(key).join(" | ")})`
    case "not":
      return `~${key(type.type)}`
  }
}

const unique = (
  types: readonly Type[]
) => [...new Map(types.map(type => [key(type), type])).values()]

const merge = (types: readonly Type[]): Type[] => {
  const functions = types.flatMap(type => type.kind === "fn" ? [type] : [])
  const records = types.flatMap(type =>
    type.kind === "record" ? [type.fields] : []
  )
  const others = types.filter(type =>
    type.kind !== "fn" && type.kind !== "record"
  )
  const fields = new Map<string, Type[]>()
  for (const found of records) {
    for (const [label, field] of found) {
      fields.set(label, [...(fields.get(label) ?? []), field])
    }
  }
  const tagged = others.some(type => type.kind === "tag")
  const merged = [
    ...(functions.length
      ? [
        fn(or(...functions.map(f => f.from)), and(...functions.map(f => f.to)))
      ]
      : []),
    ...(records.length && (fields.size || !tagged)
      ? [record(new Map([...fields].map(([l, all]) => [l, and(...all)])))]
      : [])
  ]
  return [...others, ...merged]
}

export const and = (...types: readonly Type[]): Type => {
  const flat = types.flatMap(type => type.kind === "and" ? type.types : [type])
  if (flat.some(type => type.kind === "bottom")) return nothing
  const parts = unique(merge(flat.filter(type => type.kind !== "top")))
  const [first, ...rest] = parts
  if (!first) return anything
  return rest.length === 0 ? first : { kind: "and", types: parts }
}

export const or = (...types: readonly Type[]): Type => {
  const flat = types.flatMap(type => type.kind === "or" ? type.types : [type])
  if (flat.some(type => type.kind === "top")) return anything
  const parts = unique(flat.filter(type => type.kind !== "bottom"))
  const [first, ...rest] = parts
  if (!first) return nothing
  return rest.length === 0 ? first : { kind: "or", types: parts }
}

export const not = (type: Type): Type => {
  switch (type.kind) {
    case "top":
      return nothing
    case "bottom":
      return anything
    case "not":
      return type.type
    case "and":
      return or(...type.types.map(not))
    case "or":
      return and(...type.types.map(not))
    default:
      return { kind: "not", type }
  }
}

const wrap = (type: Type, names: Map<number, string>, kinds: string[]) =>
  kinds.includes(type.kind) ? `(${show(type, names)})` : show(type, names)

export const show = (type: Type, names = new Map<number, string>()): string => {
  switch (type.kind) {
    case "top":
      return "anything"
    case "bottom":
      return "nothing"
    case "var": {
      const name = names.get(type.id)
        ?? `'${String.fromCharCode(97 + names.size)}`
      names.set(type.id, name)
      return name
    }
    case "fn":
      return `${wrap(type.from, names, ["fn"])} -> ${show(type.to, names)}`
    case "record": {
      const fields = [...type.fields].map(([label, field]) =>
        `${label} : ${show(field, names)}`
      )
      return fields.length ? `{ ${fields.join(", ")} }` : "{}"
    }
    case "tag":
      return type.name
    case "and":
      return type.types.map(part => wrap(part, names, ["fn", "or"])).join(" & ")
    case "or":
      return type.types.map(part => wrap(part, names, ["fn", "and"])).join(
        " | "
      )
    case "not":
      return `~${wrap(type.type, names, ["fn", "and", "or"])}`
  }
}
