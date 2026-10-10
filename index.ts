export {
  Check,
  check,
  fail,
  fresh,
  generalize,
  instantiate,
  local,
  lookup,
  pure,
  resolve,
  run,
  unify,
  type Context,
  type Env,
  type Reply,
  type Result
} from "./src/check.ts"

export {
  bool,
  con,
  fn,
  free,
  int,
  mono,
  show,
  tvar,
  type Scheme,
  type Type
} from "./src/type.ts"

export { render, type Diagnostic, type Span } from "./src/diagnostic.ts"
