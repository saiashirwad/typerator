export {
  fresh,
  generalize,
  instantiate,
  local,
  lookup,
  resolve,
  unify,
  type Env
} from "./infer.ts"

export {
  bool,
  con,
  empty,
  extend,
  fn,
  free,
  int,
  mono,
  record,
  show,
  tvar,
  type Scheme,
  type Type
} from "./type.ts"
