# typerator

Generator-based combinators for writing type checkers in TypeScript.

[parserator](https://github.com/saiashirwad/parserator) turns text into trees.
typerator checks that the trees make sense. Typing rules read like their
formal definitions:

```ts
case "app":
  return check(function*() {
    const func = yield* infer(expr.func)
    const param = yield* fresh()
    const result = yield* fresh()
    yield* unify(func, fn(param, result)).at(expr.func.span)
    yield* expect(expr.arg, param, "function argument")
    return result
  })
```

and errors point at the code that caused them:

```
line 3, column 5:
  1 | let inc = fun n -> n + 1 in
  2 | let flag = inc 1 == 2 in
> 3 | inc flag
    |     ^^^^
Expected int, found bool
While checking: function argument
```

Requires Node 24+ and TypeScript 7. Sources are plain `.ts` and run directly
with `node`.

## Checks

A `Check<A>` is a typing step that produces an `A` or fails with a
diagnostic. `check(function* …)` sequences steps with `yield*`.

| Combinator               | Meaning                                         |
| ------------------------ | ----------------------------------------------- |
| `check(function* …)`     | Sequence checks                                 |
| `run(check, env?)`       | Run a check, returning `{ success, value }`     |
| `pure(value)`            | Succeed with a value                            |
| `fail(message)`          | Fail with a message                             |
| `sequence([a, b, …])`    | Run checks in order, collecting a typed tuple   |
| `choice(a, b, …)`        | First check that succeeds, undoing failed ones  |
| `attempt(check)`         | Undo every effect of a check if it fails        |
| `check.map(f)`           | Transform the value                             |
| `check.flatMap(f)`       | Continue with another check                     |
| `check.context(label)`   | Label errors with where they happened           |
| `check.at(span)`         | Attach a source span to errors                  |
| `check.recover(other?)`  | Record the error, continue with `other`         |
| `within(key, f, check)`  | Run `check` with a scoped value changed by `f`  |

`recover` lets one run report every error instead of stopping at the first:

```ts
const expect = (expr: Expr, expected: Type, label: string) =>
  infer(expr)
    .flatMap(found => unify(found, expected))
    .context(label)
    .at(expr.span)
    .recover()
```

## Kits

The core knows nothing about types. Kits bring a type representation and
the steps that solve it:

```ts
import { check, run } from "typerator"
import { fresh, unify } from "typerator/unify"
import { constrain } from "typerator/subtype"
```

### `typerator/unify`: Hindley–Milner

Types are type variables, named constructors and rows:

| Value                      | Meaning                                       |
| -------------------------- | --------------------------------------------- |
| `int`, `bool`              | Built-in constructors                         |
| `con(name, ...args)`       | Any constructor, such as `con("list", int)`   |
| `fn(from, to)`             | Function type                                 |
| `record(fields, rest?)`    | Record, closed or open when `rest` is a var   |
| `tvar(id)`, `mono(type)`   | Type variable, scheme without quantifiers     |
| `show(type)`               | `{ x : int \| 'a } -> int`                    |

Inference uses Hindley–Milner with row polymorphism:

| Combinator                 | Meaning                                       |
| -------------------------- | --------------------------------------------- |
| `fresh()`                  | A new type variable                           |
| `unify(found, expected)`   | Constrain two types to be equal               |
| `resolve(type)`            | Apply everything solved so far                |
| `lookup(name)`             | A variable's scheme                           |
| `local(name, scheme, c)`   | Run `c` with a variable in scope              |
| `local(env, c)`            | Run `c` with several variables in scope       |
| `generalize(type)`         | Quantify variables not bound in scope         |
| `instantiate(scheme)`      | Replace quantified variables with fresh ones  |

```ts
case "let":
  return check(function*() {
    const value = yield* infer(expr.value).flatMap(generalize)
    return yield* local(expr.name, value, infer(expr.body))
  })
```

### `typerator/subtype`: MLstruct

Inference with subtyping in a Boolean algebra of structural types, after
[MLstruct](https://doi.org/10.1145/3563304). Types are `anything`,
`nothing`, type variables, functions, records, class tags, and `and`, `or`
and `not` of them. No annotations needed:

```
fun x -> if x is Some then x.value else 0
  : { value : 'a } | ~Some -> 'a | int

fun x -> { a = x, b = x.f }
  : 'a & { f : 'b } -> { a : 'a, b : 'b }
```

| Combinator                 | Meaning                                       |
| -------------------------- | --------------------------------------------- |
| `fresh()`                  | A new type variable                           |
| `constrain(found, expected)` | Require `found` to be a subtype of `expected` |
| `resolve(type)`            | Turn bounds into a readable type              |
| `generalize(check)`        | Run `check` one level deeper, then quantify   |
| `instantiate(scheme)`      | Copy quantified variables with their bounds   |
| `lookup`, `local`          | As in `typerator/unify`                       |

Refining a variable with `if x is C` is two constraints:

```ts
const matched = yield* fresh()
const unmatched = yield* fresh()
yield* expect(x, or(and(tag(C), matched), and(not(tag(C)), unmatched)))
```

### Writing a kit

A kit keeps its state under typed keys, so `attempt` and `choice` can undo
it, and `within` can scope it:

```ts
const solution = state(() => new Map<number, Type>(), map => new Map(map))
const env = scoped<ReadonlyMap<string, Scheme>>(new Map())

export const lookup = (name: string): Check<Scheme> =>
  new Check(scope => {
    const scheme = scope.get(env).get(name)
    return scheme ? Reply.ok(scheme) : Reply.error(`Unbound variable: ${name}`)
  })
```

## Diagnostics

`render(diagnostic, source)` prints a diagnostic in the same layout as
parserator's parse errors, so both kinds of error look alike.

## Examples

```sh
pnpm examples
```

- `examples/arith.ts` — ints, strings and `if`, with `+` overloaded through
  `choice`
- `examples/ml/` — a small ML with:
  - polymorphic `let`
  - `let rec`
  - records with row polymorphism
  - type annotations
  - multiple errors per program
- `examples/mlstruct/` — the same language with subtyping, class instances
  like `Some { value = 1 }`, and `if x is Some then … else …`

## Development

```sh
pnpm typecheck
pnpm test
pnpm fmt
```
