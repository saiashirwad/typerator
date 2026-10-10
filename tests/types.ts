import {
  check,
  choice,
  fail,
  get,
  pure,
  run,
  scoped,
  sequence,
  state,
  within,
  type Check,
  type Result,
  type Scoped,
  type State
} from "typerator"

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false
type Assert<T extends true> = T

const ordinary = run(pure({ name: "x", count: 1 }))
export type Ordinary = Assert<
  Equal<typeof ordinary, Result<{ name: string; count: number }>>
>

const tuple = run(sequence([pure(1), pure("two"), pure(true)]))
export type Tuple = Assert<
  Equal<typeof tuple, Result<[number, string, boolean]>>
>

const depth = scoped(0)
const stateful = check(function*() {
  const count = yield* get(depth)
  const label = yield* pure("two")
  return { count, label }
})
export type Stateful = Assert<
  Equal<typeof stateful, Check<{ count: number; label: string }>>
>

const alternatives = run(choice(pure(1), pure("two"), fail("no")))
export type Alternatives = Assert<
  Equal<typeof alternatives, Result<number | string>>
>

const fallback = run(fail("no").recover(pure(1)))
export type Fallback = Assert<Equal<typeof fallback, Result<number>>>

const stop = run(fail("no"))
export type Stop = Assert<Equal<typeof stop, Result<never>>>

const invalid = () => {
  // @ts-expect-error scoped values retain their declared type
  get(depth).map(value => value.missing)
  // @ts-expect-error recovery of a value requires a fallback
  pure(1).recover()
  // @ts-expect-error alternatives must be nonempty
  choice()
  // @ts-expect-error widening a writable scope key would corrupt typed reads
  const widened: Scoped<number | string> = depth
  void widened
  const erased: { readonly kind: "scoped"; readonly initial: number | string } =
    depth
  // @ts-expect-error erasing the invariant marker cannot manufacture a scope key
  const reconstructed: Scoped<number | string> = erased
  void reconstructed
  // @ts-expect-error scope updates must preserve the key's value type
  within(depth, () => "not a number", get(depth))
  const counter = state(() => ({ next: 0 }), current => {
    const next = current.next
    return () => {
      current.next = next
    }
  })
  // @ts-expect-error mutable state keys cannot widen their stored value type
  const widenedState: State<{ next: number | string }> = counter
  void widenedState
}
void invalid
