export type State<T> = {
  readonly kind: "state"
  init(): T
  copy(value: T): T
}

export type Scoped<T> = { readonly kind: "scoped"; readonly initial: T }

export const state = <T>(
  init: () => T,
  copy: (value: T) => T
): State<T> => ({ kind: "state", init, copy })

export const scoped = <T>(initial: T): Scoped<T> => ({
  kind: "scoped",
  initial
})

export class Scope {
  readonly #scoped: ReadonlyMap<Scoped<unknown>, unknown>
  readonly #states: Map<State<unknown>, unknown>

  constructor(
    scoped: ReadonlyMap<Scoped<unknown>, unknown> = new Map(),
    states: Map<State<unknown>, unknown> = new Map()
  ) {
    this.#scoped = scoped
    this.#states = states
  }

  get<T>(key: State<T> | Scoped<T>): T {
    if (key.kind === "scoped") {
      return (this.#scoped.has(key) ? this.#scoped.get(key) : key.initial) as T
    }
    if (!this.#states.has(key)) this.#states.set(key, key.init())
    return this.#states.get(key) as T
  }

  with<T>(key: Scoped<T>, value: T): Scope {
    return new Scope(new Map(this.#scoped).set(key, value), this.#states)
  }

  snapshot(): () => void {
    const saved = [...this.#states].map(([key, value]) =>
      [key, key.copy(value)] as const
    )
    return () => {
      this.#states.clear()
      for (const [key, value] of saved) this.#states.set(key, value)
    }
  }
}
