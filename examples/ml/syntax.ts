import type { Span } from "typerator"

type Node =
  | { readonly kind: "var"; readonly name: string }
  | { readonly kind: "lit"; readonly value: number | boolean }
  | { readonly kind: "lam"; readonly param: string; readonly body: Expr }
  | { readonly kind: "app"; readonly func: Expr; readonly arg: Expr }
  | {
    readonly kind: "record"
    readonly fields: readonly (readonly [string, Expr])[]
  }
  | { readonly kind: "field"; readonly record: Expr; readonly label: string }
  | {
    readonly kind: "let" | "rec"
    readonly name: string
    readonly value: Expr
    readonly body: Expr
  }
  | { readonly kind: "annot"; readonly expr: Expr; readonly type: TypeExpr }
  | {
    readonly kind: "if"
    readonly cond: Expr
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
  record: (fields: readonly (readonly [string, Expr])[]): Expr => ({
    kind: "record",
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
  rec: (name: string, value: Expr, body: Expr): Expr => ({
    kind: "rec",
    name,
    value,
    body
  }),
  annot: (expr: Expr, type: TypeExpr): Expr => ({
    kind: "annot",
    expr,
    type
  }),
  if: (cond: Expr, then: Expr, otherwise: Expr): Expr => ({
    kind: "if",
    cond,
    then,
    else: otherwise
  })
}

type TypeNode =
  | { readonly kind: "name"; readonly name: string }
  | { readonly kind: "var"; readonly name: string }
  | { readonly kind: "fn"; readonly from: TypeExpr; readonly to: TypeExpr }
  | {
    readonly kind: "record"
    readonly fields: readonly (readonly [string, TypeExpr])[]
  }

export type TypeExpr = TypeNode & { readonly span?: Span }

export const TypeExpr = {
  name: (name: string): TypeExpr => ({ kind: "name", name }),
  var: (name: string): TypeExpr => ({ kind: "var", name }),
  fn: (from: TypeExpr, to: TypeExpr): TypeExpr => ({ kind: "fn", from, to }),
  record: (fields: readonly (readonly [string, TypeExpr])[]): TypeExpr => ({
    kind: "record",
    fields
  })
}
