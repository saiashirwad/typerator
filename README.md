# typerator

Generator-based combinators for writing type checkers in TypeScript.

```ts
import { check, render, run } from "typerator"
import { fn, fresh, int, resolve, show, unify } from "typerator/unify"

const identityAppliedToInt = check(function*() {
  const a = yield* fresh()
  const result = yield* fresh()
  yield* unify(fn(a, a), fn(int, result))
  return yield* resolve(result)
})

const result = run(identityAppliedToInt)
if (result.success) {
  console.log(show(result.value)) // int
} else {
  for (const error of result.errors) console.error(render(error))
}
```

