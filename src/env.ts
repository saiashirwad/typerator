import { fail, get, pure, within, type Check } from "./check.ts"
import type { Scoped } from "./scope.ts"

type Names<S> = Scoped<ReadonlyMap<string, S>>

export const lookup = <S>(env: Names<S>, name: string): Check<S> =>
  get(env).flatMap(current =>
    current.has(name)
      ? pure(current.get(name) as S)
      : fail(`Unbound variable: ${name}`)
  )

export const bind = <S, A>(
  env: Names<S>,
  bindings: Iterable<readonly [string, S]>,
  body: Check<A>
): Check<A> => within(env, current => new Map([...current, ...bindings]), body)
