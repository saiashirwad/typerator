import type { Span } from "typerator"

type Fields = readonly (readonly [string, Expr])[]

type Node =
  | { readonly kind: "var"; readonly name: string }
  | { readonly kind: "lit"; readonly value: number | boolean }
  | { readonly kind: "lam"; readonly param: string; readonly body: Expr }
  | { readonly kind: "app"; readonly func: Expr; readonly arg: Expr }
  | { readonly kind: "record"; readonly fields: Fields }
  | { readonly kind: "instance"; readonly tag: string; readonly fields: Fields }
  | { readonly kind: "field"; readonly record: Expr; readonly label: string }
  | {
    readonly kind: "let"
    readonly name: string
    readonly value: Expr
    readonly body: Expr
  }
  | {
    readonly kind: "if"
    readonly cond: Expr
    readonly then: Expr
    readonly else: Expr
  }
  | {
    readonly kind: "is"
    readonly scrutinee: Expr
    readonly tag: string
    readonly then: Expr
    readonly else: Expr
  }

export type Expr = Node & { readonly span?: Span }

export const Expr = {
  var: (name: string): Expr => ({ kind: "var", name }),
  lit: (value: number | boolean): Expr => ({ kind: "lit", value }),
  lam: (param: string, body: Expr): Expr => ({ kind: "lam", param, body }),
  app: (func: Expr, ...args: readonly Expr[]): Expr =>
    args.reduce<Expr>((func, arg) => ({ kind: "app", func, arg }), func),
  record: (fields: Fields): Expr => ({ kind: "record", fields }),
  instance: (tag: string, fields: Fields): Expr => ({
    kind: "instance",
    tag,
    fields
  }),
  field: (record: Expr, label: string): Expr => ({
    kind: "field",
    record,
    label
  }),
  let: (name: string, value: Expr, body: Expr): Expr => ({
    kind: "let",
    name,
    value,
    body
  }),
  if: (cond: Expr, then: Expr, otherwise: Expr): Expr => ({
    kind: "if",
    cond,
    then,
    else: otherwise
  }),
  is: (scrutinee: Expr, tag: string, then: Expr, otherwise: Expr): Expr => ({
    kind: "is",
    scrutinee,
    tag,
    then,
    else: otherwise
  })
}
