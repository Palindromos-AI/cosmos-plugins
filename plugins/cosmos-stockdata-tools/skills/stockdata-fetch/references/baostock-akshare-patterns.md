# baostock and AKShare Fallback Patterns

Read-only, contract-neutral implementation guidance for the two fallback rungs
of the source ladder. These shapes come from the libraries' public documented
APIs, not from a prior validated extraction in this project: before relying on
an endpoint, field, or semantic, verify it with official documentation or one
minimal capability probe. Treat every example as evidence for implementation
shape, never as authorization for its dataset, field, limit, or output.

## Contents

- [When a fallback rung applies](#when-a-fallback-rung-applies)
- [baostock session and call shapes](#baostock-session-and-call-shapes)
- [AKShare call shapes](#akshare-call-shapes)
- [Instrument-code mapping](#instrument-code-mapping)
- [Adjustment and calendar semantics](#adjustment-and-calendar-semantics)
- [Source-outcome classification](#source-outcome-classification)

## When a fallback rung applies

Use baostock only for the portion of a requirement that SuperMind demonstrably
cannot supply, and AKShare only when baostock also cannot cover that portion.
A coverage gap is proven by a documented absence or a minimal capability probe,
never by an authentication, permission, rate-limit, network, or temporary
service failure. Each dataset or field keeps one declared primary source, and
provenance records which source actually delivered it.

## baostock session and call shapes

Every baostock call needs a process-level session. baostock reports failure
through result objects instead of raising, so check `error_code` after every
call, including login:

```python
import baostock as bs

session = bs.login()
if session.error_code != "0":
    raise ConnectionError(f"baostock login failed: {session.error_msg}")
try:
    result = bs.query_history_k_data_plus(
        code,                     # e.g. "sh.600000" / "sz.000001"
        fields,                   # comma-joined field list, frequency-specific
        start_date=start_date,    # "YYYY-MM-DD"
        end_date=end_date,
        frequency="d",            # "d"/"w"/"m"; minute bars use "5"/"15"/"30"/"60"
        adjustflag=adjustflag,
    )
    rows = []
    while result.error_code == "0" and result.next():
        rows.append(result.get_row_data())
finally:
    bs.logout()
```

Build the DataFrame from `result.fields` and `rows`. Every returned value is a
string; convert types explicitly in the adapter and treat empty strings as
missing values rather than zeros. The valid field list differs per frequency —
probe the exact frequency the contract needs instead of copying a daily field
list onto minute bars.

Other commonly needed call shapes: `bs.query_trade_dates(start_date, end_date)`
returns a calendar with an `is_trading` column of `"1"`/`"0"` strings;
`bs.query_stock_basic()` returns listing metadata; `bs.query_all_stock(day=...)`
returns the securities tradable on one day.

## AKShare call shapes

AKShare wraps public web endpoints and returns pandas DataFrames directly. The
upstream pages change without notice, so pin the `akshare` version in the
workspace dependency declaration and validate returned columns against the
contract on every run.

```python
import akshare as ak

frame = ak.stock_zh_a_hist(
    symbol="600000",          # bare six-digit code, no exchange prefix
    period="daily",
    start_date="20260101",    # "YYYYMMDD", unlike baostock
    end_date="20260821",
    adjust="",                # "" none, "qfq" forward-adjusted, "hfq" back-adjusted
)
```

Column labels are Chinese (for example `日期`, `收盘`); map them to contract
columns explicitly by name, never by position. An empty DataFrame can mean an
out-of-range request rather than an error — distinguish "no rows" from
"unsupported" explicitly. Consecutive calls may be throttled or blocked by the
upstream site; space out batches and classify HTTP or parsing failures as
operational, not as coverage gaps.

## Instrument-code mapping

Each source spells the same instrument differently: baostock uses a lower-case
exchange prefix with a dot (`sh.600000`), AKShare's A-share history interface
takes the bare numeric code (`600000`), and SuperMind uses its own provider
symbol (see `supermind-api-patterns.md`). Normalize instrument identity once in
the workspace contract and translate at each adapter boundary; never let one
source's spelling leak through a shared column.

## Adjustment and calendar semantics

Price-adjustment flags do not transfer between sources: baostock's
`adjustflag` uses `"1"` back-adjusted, `"2"` forward-adjusted, `"3"`
unadjusted, while AKShare uses `""`/`"qfq"`/`"hfq"`. Confirm each source's
convention against its documentation before comparing or combining prices, and
record the convention in provenance. Derive the trading calendar from one
declared source for the whole workflow; mixing calendars silently shifts
boundary dates.

## Source-outcome classification

- Login failures, network errors, HTTP failures, throttling, and upstream page
  changes are operational failures: report them visibly; they never move a
  dataset down the ladder by themselves.
- A documented absence or an empty minimal probe against a correct request is
  coverage-gap evidence: record the probe and its result before implementing
  the next rung.
- A partially failing batch is not silently deliverable: follow the failure
  semantics in `implementation-architecture.md`.
