# CLS telegraph request contract

Read this reference only when the fetcher fails, the CLS response shape changes, or the request implementation must be reviewed.

## Source and stability

- Page: `https://www.cls.cn/telegraph`
- Data endpoint: `GET https://www.cls.cn/v1/roll/get_roll_list`
- The endpoint is used by the CLS web client but is not a documented public API.
- Treat every field and request parameter as an external, unstable contract.
- Do not bypass authentication, CAPTCHA, paywalls, or access restrictions.
- Stop and report an HTTP 418 instead of silently switching sources.

## Request parameters

The current web client sends:

| Parameter | Value or meaning |
| --- | --- |
| `app` | `CailianpressWeb` |
| `os` | `web` |
| `sv` | Current observed web-client version, presently `8.7.9` |
| `refresh_type` | `1` |
| `rn` | Page size |
| `last_time` | Exclusive Unix-second cursor |
| `sign` | Request signature |

Create the signature by:

1. Sorting all parameters except `sign` by case-insensitive key order.
2. Joining scalar values as `key=value` with `&`.
3. Computing the SHA-1 hex digest of that canonical string.
4. Computing the MD5 hex digest of the SHA-1 hex string.

Do not add secrets, cookies, tokens, or browser-profile data.

## Pagination

- Start at the earlier of the current Unix second plus one and the target Shanghai day's exclusive end.
- Require every `ctime` to be an integer Unix-second value smaller than the requested exclusive `last_time`.
- Request older messages using the final returned item's `ctime + 1` as the next `last_time`. The one-second overlap prevents an exclusive cursor from skipping messages that share the boundary timestamp.
- Require each returned page's `ctime` values to be monotonically non-increasing and require each subsequent page's first `ctime` not to exceed the prior page's tail. Equal timestamps are valid, but any forward movement invalidates the tail cursor and must fail the fetch.
- Stop only after a page crosses Shanghai midnight.
- Treat an empty page before crossing midnight as an incomplete-source failure.
- Deduplicate by numeric message `id`.
- Reject a page whose overlapped cursor does not move behind the prior cursor.

## Response fields used

The response is expected to contain:

```text
errno
data.roll_data[]
  id
  ctime
  title
  brief
  content
  subjects[].subject_name
  stock_list[].name
```

Use `content` as the original body when non-empty, otherwise use `brief`. Link a message to `https://www.cls.cn/detail/<id>`.
