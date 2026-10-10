# Generator ergonomics with one runtime

The examples yield `Check` values to access typed state and lexical scope. This
keeps inference rules compact. The runtime, state keys, scope, and environment
helpers now live together in `src/check.ts` instead of three modules.

## Candidates

Candidate A used ordinary functions with `Context<S>`, lexical environment
arguments, and solver-owned in-place checkpoints. Candidate B used immutable
`Check<S, A>` computations, explicit state transitions, and optional generator
sequencing. Both removed dynamically scoped environments and levels.

The review scored A higher for direct inference rules, TypeScript ergonomics,
implementation size, and compatibility with the mutable solver algorithms. B's
immutable state versions simplify rollback, but require rewriting every nested
mutation and retain a computation layer between the reader and the rule.

## Rejected first implementation

The first implementation chose A and passed 84 runtime tests plus TypeScript
checking. The user rejected its ergonomics: passing `ctx`, `env`, and `level`
through every inference rule was noisier than the previous generator API.

## Final decision

Restore generators as the primary API. Remove the explicit-context API rather
than keep both execution models. Keep typed state keys and lexical scope, but
collapse their implementation into one runtime. The user chose this direction
over a solver-local session design.

Keep atomic public constraints from B. `.atomic()` restores state and preserves
the original failure without converting it to a result and reconstructing it.
Expectation helpers recover only their constraint, so successful operand
inference survives. `recover` remains nontransactional; `attempt` and `choice`
discard speculative state and recovered errors.

Keep the existing `Result` and diagnostic shapes. Severity, diagnostic codes,
related errors, and partial-value results were rejected as unrelated additions.
The runtime captures labels and spans when a diagnostic is raised, so outer labels
apply to recovered errors too. Immutable child runtimes carry lexical metadata;
per-run storage owns mutable states and diagnostics.

Record constructors use iterable entries instead of object-or-Map compatibility
branches. Structural type transformations reuse the existing child traversal.
The generator runner closes abandoned iterators so synchronous cleanup runs.

The final review found that covariant scope keys could write a string through a
widened number key and then read it as a number. State and scope keys now carry a
private invariant marker. The runtime stores each state's value with its typed
checkpoint closure rather than pretending all keys accept `unknown` values.
Compile-time tests reject both direct widening and reconstruction from an erased
structural shape. The direct widening tests failed before the fix.

## Verification and limits

`tests/ml.test.ts` and `tests/mlstruct.test.ts` retain the original inference cases.
New tests exercise atomic constraints and alias-preserving rollback. Core tests
cover recovered alternatives, nested scopes, and unexpected exceptions.
`tests/types.ts` checks TypeScript inference and invalid calls.

The architecture judge ran as a separate read-only session on GPT-6.1 Sol, the same
model family as the author. It was independent review, not cross-model evidence.
The structural solver's existing semantic approximations remain documented in
`README.md`; they were not hidden behind a shared inference abstraction.
