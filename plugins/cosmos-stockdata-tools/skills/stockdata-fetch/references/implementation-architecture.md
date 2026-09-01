# Stockdata Implementation Architecture

Use this reference before creating the first business capability in a user's
stockdata workspace, and again before a change that crosses module boundaries.
It describes responsibilities and invariants, not a fixed repository layout or
data contract.

## Contents

- [Scope boundary](#scope-boundary)
- [Processing flow](#processing-flow)
- [Failure semantics](#failure-semantics)
- [Workspace evolution](#workspace-evolution)
- [Minimum verification matrix](#minimum-verification-matrix)
- [Anti-patterns](#anti-patterns)

## Scope boundary

The installed Skill owns only generic transport and read-only implementation
guidance. The user's durable workspace owns every executable business script,
test, dependency declaration, accepted field definition, output contract, and
retrieved dataset.

Start with the smallest structure that keeps the current vertical slice clear.
Split a responsibility into its own module when it gains independent behavior,
tests, a second source, or a second consumer. Do not create empty framework
layers in anticipation of unknown requirements.

## Processing flow

```text
accepted contract
      |
      v
source adapter -> normalization -> contract validation -> delivery
      |                    |                |                |
      +--------------------+----------------+----------------+
                           provenance
```

### Accepted contract

Record the material choices before implementation:

- instruments and universe membership rules;
- field definitions, units, currency, and null meaning;
- frequency, requested market-time range, trading calendar, and timezone;
- price-adjustment convention when applicable;
- output schema, destination, and append, replace, or upsert behavior;
- coverage, freshness, uniqueness, and missing-value acceptance checks.

The contract is requirement-specific. Never import fields, thresholds, sheets,
or market scope from an example merely because its source call is reusable.

### Source adapter

A source adapter translates the accepted contract into one provider's calls. It
owns endpoint arguments, provider identifiers, batching, rate-limit behavior,
and the distinction between an unsupported capability and an operational
failure. It returns source-shaped data plus retrieval facts; it does not rename
columns to hide which provider supplied them.

Each dataset or field has one declared primary source. Follow the source ladder
at that granularity. Do not query a later source for routine duplication.

### Normalization

Normalization converts source-shaped data into the accepted output meaning. It
owns identifier mappings, column names, types, units, adjustment conventions,
market dates, and explicit mixed-source precedence. Keep raw source columns or
a reproducible mapping when a transformation is not self-evident.

Normalization must not decide whether incomplete data is acceptable. That is a
contract-validation decision.

### Contract validation

Validation compares the normalized result with the accepted contract before
delivery. At minimum, test the checks that apply to the requested capability:

- requested versus returned instruments, fields, and market dates;
- duplicate keys and stable key types;
- required-null and optional-null behavior;
- freshness and `as_of` dates for delayed datasets;
- adjustment, unit, and timezone boundaries;
- batch completeness and any explicitly accepted exclusions.

Use contract-derived expectations, not historical row-count constants. A batch
failure or unexplained missing required key makes the run incomplete. Never
publish a partial result as success.

### Delivery

Delivery writes only a validated result through the user-selected interface. It
owns serialization, destination paths, atomic replacement where needed, and
append or upsert semantics. It must not add financial calculations or silently
repair source gaps.

For file delivery, assign one stable `<dataset-key>` to each accepted material
dataset identity. A single-date output belongs at
`<stockdata-workspace>/output/YYYY-MM-DD/<dataset-key>.<format>` using the
requested Beijing market date. A range belongs at
`<stockdata-workspace>/output/ranges/YYYY-MM-DD_to_YYYY-MM-DD/<dataset-key>.<format>`.
The same dataset identity at the same date or range must atomically replace its
earlier generated file after validation; different dataset identities coexist
as separate files. An incomplete result must never replace a complete result.
Record the identity and provenance in the delivered format or a deterministic
companion manifest so a filename collision cannot silently cross contracts.

Validate a temporary output before replacing an existing durable artifact. Do
not overwrite an existing file unless the accepted delivery contract allows it.

### Provenance

Provenance follows the result across all stages. Preserve enough information to
reproduce and audit it:

- source, endpoint or function, and source-library version when material;
- retrieval time and requested market-time range;
- actual source `as_of` date;
- material parameters and adjustment convention;
- requested, returned, missing, and explicitly excluded identifiers;
- source columns and normalization rules;
- batch failures, retries, and final completeness status.

Provenance is metadata, not a place for credentials, tokens, cookies, or account
identifiers.

## Failure semantics

Keep these outcomes distinct and visible:

| Outcome | Meaning | Required behavior |
| --- | --- | --- |
| Unsupported capability | A successful probe shows the source lacks the required dataset, field, range, or semantic | Record the evidence, then evaluate the next source |
| Operational failure | Authentication, permission, network, timeout, rate-limit, service, or execution failure | Surface the failure; do not change sources |
| Empty valid response | The call succeeded and the source returned no rows for the exact request | Apply the contract's empty-result rule; do not infer unsupported coverage |
| Incomplete batch result | One or more requested batches, identifiers, fields, or dates are unresolved | Fail validation unless the contract explicitly excludes them |
| Contract violation | Retrieved data conflicts with required schema, uniqueness, freshness, units, or coverage | Retain diagnostics and block delivery |

## Workspace evolution

For the first vertical slice, one entry point, one source adapter, and focused
tests may be sufficient. As accepted capabilities accumulate:

1. Extend the existing entry point rather than adding an unrelated script.
2. Reuse an adapter only when provider semantics are genuinely the same.
3. Extract shared normalization after a second real consumer appears.
4. Keep delivery formats independent from source adapters.
5. Add contract tests before changing accepted behavior.
6. Preserve prior interfaces unless the user explicitly changes them.

## Minimum verification matrix

Use a small real-source sample in addition to offline tests. Select only cases
relevant to the accepted capability:

- one representative instrument per identifier or exchange family;
- an empty response or non-trading day;
- both sides of the relevant Beijing market-date boundary;
- a missing optional value and a missing required value;
- a duplicate-key fixture;
- more than one batch when batching is used;
- one injected batch failure proving that delivery is blocked;
- the requested adjustment or delayed-data boundary.

## Anti-patterns

- A monolithic script that mixes provider calls, financial calculations,
  validation, and file output.
- Broad exception handling that logs an error and continues to successful
  delivery.
- Fixed all-market schemas, output sheets, or coverage thresholds inherited from
  an unrelated extraction.
- Source fallback caused by an operational failure rather than demonstrated
  unsupported coverage.
- A normalized common column that hides a source change or incompatible unit.
- Machine-specific paths, credentials, or mutable runtime state in the Skill.
