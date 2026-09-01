# Fix report template

Fill every section; write "none" rather than deleting a section. Replace local
details with stable placeholders such as `<cosmos-workspace-root>` and
`<marketplace-root>`. Never include private source content, credentials,
account identifiers, signed URLs, absolute local paths, or business
identifiers such as group or planet names.

```markdown
# <plugin-name> <scope> fix report

- Plugin: <plugin-name> <packaged-version>
- Scope: <skill-or-plugin-scope>
- Timestamp (UTC): <YYYY-MM-DDTHHMMSSZ>
- Status: <repaired|partially-repaired|reverted>

## Why the change was needed

<one or two sentences: what broke, observed vs. expected behavior>

## Reproduction

<steps or "not reproducible on demand">

## Changed packaged paths

- `<path relative to the installed plugin root>`: <one-line description>

## Diff

<minimal unified diff, only when it contains no private content; otherwise
"omitted: <reason>">

## Validation

- `<command>`: exit <code>, <result summary>

## Limitations

<known limitations; whether unrelated local modifications existed; anything
that could not be attributed to the current task>
```
