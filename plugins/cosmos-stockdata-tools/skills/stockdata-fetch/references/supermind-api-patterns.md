# SuperMind API Patterns

Read this reference before writing or changing a SuperMind adapter or capability
probe. These are source-level patterns extracted from a previously validated
implementation. They are not a full extraction program, a complete API catalog,
or an output contract.

Verify any unobserved endpoint, field, date range, or financial meaning through
official documentation, the user's existing research environment, or one
minimal real probe. A historical working pattern does not prove that every
account has the same permissions or that a provider interface never changes.

## Contents

- [Research-environment constraints](#research-environment-constraints)
- [Remote transport files](#remote-transport-files)
- [Trading dates and Beijing time](#trading-dates-and-beijing-time)
- [Security universes and metadata](#security-universes-and-metadata)
- [One-day price shape](#one-day-price-shape)
- [Query-style datasets](#query-style-datasets)
- [Batch retrieval without partial success](#batch-retrieval-without-partial-success)
- [Source outcome classification](#source-outcome-classification)
- [Provider-specific validation checklist](#provider-specific-validation-checklist)

## Research-environment constraints

SuperMind business code executes in the remote research kernel, where provider
functions are made available through:

```python
from mindgo_api import *
import pandas as pd
```

Keep probes minimal. Previously observed compile-time review rejections include
`import sys`, `import inspect`, `getattr`, `import pathlib`, `import os`, the
built-in `open`, `DataFrame.eval`, and `DataFrame.query`. Prefer ordinary
boolean indexing and direct column access. Do not retry identical code after an
`InputRejected` response; rewrite the rejected construct.

Compatibility can also lag local environments. In one observed runtime,
`DataFrame.isnull()` worked while `DataFrame.isna()` did not. Prefer the
older-compatible spelling unless a capability probe establishes otherwise.

The local `supermind_runtime.py` is transport only. Put all imports and provider
calls needed by the accepted data contract in the workspace business script.

The Jupyter server is shared account state, not a resource owned by one
extraction. Business entry points must not call `stop-server`; the generic
runtime already deletes the exact kernel it creates. Treat `status`,
`start-server`, and `stop-server` as explicit operator actions. A status
observation alone does not establish server ownership.

## Remote transport files

Do not assume that the remote research environment can write the user's final
durable format. In one observed runtime, neither `pyarrow` nor `fastparquet` was
available. Probe the required writer when the output contract depends on it.

When a Parquet engine is unavailable, use a neutral CSV or JSON transport file
through pandas, download it with the generic runtime, then normalize, validate,
and convert it to the final durable format in the user's selected local
environment. Preserve every business key before serialization. When a provider
returns a date or identifier in the index, give every index level an explicit
contract name and convert it to columns before writing. The observed compatible
writers were `DataFrame.to_csv(...)` and `DataFrame.to_json(...)`:

```python
if any(name is None for name in frame.index.names):
    raise ValueError("name every business-key index before transport")
transport = frame.reset_index()
transport.to_csv(remote_csv_path, index=False)
transport.to_json(remote_json_path, orient="records", force_ascii=False)
```

Pandas path writers also avoid relying on direct file APIs that remote input
review may reject. Transport files are temporary implementation details:
validate downloaded content and preserved keys before atomic delivery, keep
credentials out of them, and do not expose them as the durable business
contract. Drop an index only when the accepted contract establishes that it
carries no business key.

The runtime `download` command does not delete remote transport files. Do not
represent a successful download as remote cleanup. Keep transport content to
the minimum accepted result, choose a collision-resistant remote path in the
local workspace orchestration, and record the retention limitation. If remote
retention violates the accepted privacy contract, stop before execution and
implement a separately verified cleanup capability first.

## Trading dates and Beijing time

`get_all_trade_days()` supplies the provider trading calendar. Convert it once,
then apply an explicit `Asia/Shanghai` boundary from the accepted contract:

```python
all_days = pd.DatetimeIndex(pd.to_datetime(list(get_all_trade_days())))
now_bj = pd.Timestamp.now(tz="Asia/Shanghai")
today_bj = now_bj.tz_localize(None).normalize()
eligible_days = all_days[all_days <= today_bj]

if len(eligible_days) == 0:
    raise RuntimeError("the provider trading calendar has no eligible date")
```

Do not assume the host timezone or a naive timestamp is Beijing time. Whether
the current trading day is complete, and which publication delay is acceptable,
belong to the accepted contract. Validate an explicit date against `all_days`
rather than silently moving it to another trading day.

When a dataset is delayed, return its actual source date as `as_of_date`. A
contract-approved search of earlier dates may locate the latest available row,
but the result must not be labeled as if it belonged to the requested date.

## Security universes and metadata

The observed universe call returns a DataFrame indexed by provider symbol:

```python
def load_universe(asset_type, target_date):
    securities = get_all_securities(asset_type, target_date)

    if securities.index.has_duplicates:
        raise RuntimeError("the provider universe contains duplicate symbols")

    symbols = list(securities.index)
    name_by_symbol = (
        securities["display_name"].to_dict()
        if "display_name" in securities.columns
        else {}
    )
    return securities, symbols, name_by_symbol
```

Use the requested asset type and market date; do not replace them with a fixed
universe. Preserve the provider symbol until normalization explicitly maps it.
Treat absent optional metadata columns separately from an absent universe.

For individual metadata enrichment, `get_security_info(symbol)` has been
observed to expose attributes such as `display_name` and `exchange`. Probe the
exact attributes needed by the contract because availability may differ across
asset types.

## One-day price shape

The JoinQuant-style `frequency` keyword was rejected by the observed SuperMind
signature; use the provider's `fre_step` parameter instead.

For the observed daily interface, `get_price(..., is_panel=True)` returns a
field-addressable panel. Each requested field yields a date-by-symbol table. A
single-day adapter can normalize one field at a time while preserving requested
symbol order:

```python
def load_one_day_panel(symbols, target_date, fields, skip_paused, adjustment):
    return get_price(
        symbols,
        target_date,
        target_date,
        "1d",
        fields,
        skip_paused=skip_paused,
        fq=adjustment,
        bar_count=0,
        is_panel=True,
    )


panel = load_one_day_panel(
    symbols,
    target_date,
    fields,
    skip_paused,
    adjustment,
)

requested_symbols = set(symbols)
if len(requested_symbols) != len(symbols):
    raise ValueError("requested symbols contain duplicates")

columns = {}
returned_symbols_by_field = {}
for field in fields:
    field_frame = panel[field]
    if len(field_frame.index) != 1:
        raise RuntimeError(
            "expected exactly one market-date row for field %s" % field
        )
    if field_frame.columns.has_duplicates:
        raise RuntimeError("provider returned duplicate symbols for field %s" % field)

    returned_symbols = set(field_frame.columns)
    returned_symbols_by_field[field] = returned_symbols
    missing = sorted(requested_symbols - returned_symbols)
    unexpected = sorted(returned_symbols - requested_symbols)
    if missing or unexpected:
        raise RuntimeError(
            "provider symbol mismatch for %s: missing=%r unexpected=%r"
            % (field, missing, unexpected)
        )
    columns[field] = field_frame.iloc[0].reindex(symbols)

result = pd.DataFrame(
    columns,
    index=pd.Index(symbols, name="symbol"),
).reset_index()
result.insert(0, "market_date", target_date)
```

Capture and reconcile `returned_symbols_by_field` before `reindex(symbols)`;
reindexing can create all-null rows for symbols that the provider omitted and
therefore cannot prove completeness. After construction, validate missing
required fields and required-null behavior. Do not drop null rows before the
contract decides what a null means.

Supply `skip_paused` and `adjustment` from the accepted contract. The explicit
date range uses `bar_count=0`, while `is_panel=True` selects the observed return
shape used by this pattern. If a new requirement changes frequency, date range,
count mode, or panel behavior, probe that exact signature and record the
semantics instead of guessing from the example.

For a single-symbol request, pass the symbol directly and use `is_panel=False`.
The observed response was a `DataFrame`, so validate that shape instead of
assuming a panel or scalar:

```python
def load_one_day_frame(symbol, target_date, fields, skip_paused, adjustment):
    frame = get_price(
        securities=symbol,
        start_date=target_date,
        end_date=target_date,
        fre_step="1d",
        fields=fields,
        skip_paused=skip_paused,
        fq=adjustment,
        bar_count=0,
        is_panel=False,
    )
    if not isinstance(frame, pd.DataFrame):
        raise TypeError("expected a DataFrame for a single-symbol request")
    if len(frame.index) != 1:
        raise ValueError("expected one daily row, got %s" % len(frame.index))
    return frame
```

## Query-style datasets

Two provider query-construction shapes have been observed. Pass the table and
columns selected by the accepted contract rather than embedding a dataset:

```python
def load_table_rows(table, date_column, date_yyyymmdd, contract_limit):
    return run_query(
        query(table)
        .filter(date_column == date_yyyymmdd)
        .limit(contract_limit)
    )
```

```python
def load_fundamental_rows(table, symbol_column, symbols, date_yyyymmdd):
    return get_fundamentals(
        query(table).filter(symbol_column.in_(symbols)),
        date=date_yyyymmdd,
    )
```

These examples establish query construction only. Confirm the selected table's
date format, symbol column, maximum result size, pagination behavior,
availability lag, and field meanings for the accepted contract.

Never use an arbitrary `.limit(...)` as evidence of complete coverage. If the
endpoint paginates, exhaust the documented pagination mechanism. If it does not
support complete retrieval for the requirement, record that as a demonstrated
coverage limitation.

## Batch retrieval without partial success

Choose batch size from provider documentation or a small capability probe; do
not inherit a historical constant. Keep requested identifiers, returned
identifiers, and failures explicit:

```python
def iter_batches(items, batch_size):
    if batch_size <= 0:
        raise ValueError("batch_size must be positive")
    for start in range(0, len(items), batch_size):
        yield items[start:start + batch_size]


parts = []
failures = []
for batch_number, batch in enumerate(iter_batches(symbols, batch_size)):
    try:
        part = fetch_one_batch(batch)
    except Exception as exc:
        failures.append({
            "batch_number": batch_number,
            "symbols": list(batch),
            "error_type": type(exc).__name__,
            "error": str(exc),
        })
        continue
    parts.append(part)

if failures:
    raise RuntimeError("one or more required provider batches failed: %r" % failures)

result = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame()
```

Catching at the adapter boundary is useful only when the accumulated failure is
raised before validation and delivery. A smaller retry batch may be appropriate
for request-size errors, but retry only when the error classification supports
that response. Do not turn authentication, permission, network, timeout, or
service errors into a smaller-batch loop.

After batching, compare requested and returned keys. Preserve an explicit list
of missing, unexpected, duplicate, and contract-approved excluded keys in
provenance. Required unresolved keys block delivery.

## Source outcome classification

Use empirical evidence to distinguish these cases:

- **Unsupported capability:** the call succeeds or the provider documents that
  the requested dataset, field, range, or meaning is unavailable.
- **Operational failure:** authentication, permission, network, timeout,
  rate-limit, remote execution, or provider-service failure.
- **Empty valid response:** the exact call succeeds with no rows; interpret it
  using the contract and relevant market date.
- **Incomplete response:** the call succeeds but required keys, dates, fields,
  pages, or batches remain unresolved.

Only unsupported capability permits evaluating the next source in the ladder.
An operational failure never proves that SuperMind lacks the data.

## Provider-specific validation checklist

Before a SuperMind result leaves its adapter and normalization path, verify the
applicable items:

- requested market date is a provider trading day when required;
- actual data date and delayed `as_of_date` are explicit;
- requested fields exist and their units and adjustment semantics are known;
- requested and returned symbols reconcile;
- normalized keys are unique;
- every batch or page completed;
- required nulls fail and accepted optional nulls remain visible;
- provenance names the provider function and material arguments;
- no source exception, batch failure, or missing required key was downgraded to
  a warning.
