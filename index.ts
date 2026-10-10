export {
  Check,
  attempt,
  check,
  choice,
  fail,
  fresh,
  generalize,
  instantiate,
  local,
  lookup,
  pure,
  resolve,
  run,
  sequence,
  unify,
  type Env,
  type Reply,
  type Result,
  type Scope
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
