# Sources workspace runtime

Use one user-chosen durable root shared by the Cosmos plugin family. This plugin owns only the derived `<cosmos-workspace-root>/sources` subtree and its own local binding file.

## Resolve or configure

Resolve `<plugin-dir>` as the directory containing this plugin's `skills/` directory. At the start of every source task, run:

```bash
node <plugin-dir>/scripts/workspace-runtime.mjs show-config
```

The canonical per-user configuration is `~/.config/cosmos-sources-tools/runtime.json`. If it does not exist, ask the user to choose and confirm one durable absolute `<cosmos-workspace-root>`, then run:

```bash
node <plugin-dir>/scripts/workspace-runtime.mjs configure \
  --workspace-root <absolute-cosmos-workspace-root>
```

The manager creates `<cosmos-workspace-root>/sources`, its `output/` directory, and the four `cls/`, `zsxq/`, `dingtalk/`, and `feishu/` output namespaces, then returns the root as `<sources-workspace>`. Never infer the root from the current directory, host, plugin location, or another plugin's configuration. Keep the stockdata plugin's configuration separate even when it records the same root.

Treat a binding as user identity. A conflicting root requires the user's explicit reconfiguration authorization and `--reconfigure`. Reconfiguration creates the new derived subtree when needed but never moves, copies, merges, overwrites, or deletes the old workspace.

## Persistence and ownership

- Keep `runtime.json` and `<sources-workspace>` outside every marketplace snapshot, installed plugin, Skill directory, plugin cache, and OS temporary directory.
- Marketplace, plugin, and Skill installation or update must never invoke `configure`, rewrite `runtime.json`, or create, migrate, move, overwrite, or delete user workspace content.
- Accept only schema version `1`. On an unknown, corrupt, or conflicting configuration, stop without rewriting it.
- Treat installed plugin files as replaceable read-only capability code. Treat `runtime.json` and `<sources-workspace>` as user-owned durable state.
- Write every final report inside its own `<sources-workspace>/output/{cls,zsxq,dingtalk,feishu}` namespace. An explicit output path may refine the location only within the matching source namespace; it may not write at the workspace root or cross into another source's directory.
- Keep credentials outside the workspace. Keep private run state in a dedicated OS temporary directory and remove only the exact run directory after successful verification; retained failure diagnostics do not become durable user data.
