#!/usr/bin/env python3
"""Drive the bundled SuperMind notebook through JupyterHub APIs."""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from validate_workbook import print_result, validate_workbook


BJT = timezone(timedelta(hours=8))
DEFAULT_BASE_URL = "https://supermind.10jqka.com.cn/notebook"
NOTEBOOK_NAME = "extract_daily.ipynb"
PACKAGED_NOTEBOOK = Path(__file__).with_name(NOTEBOOK_NAME)
SKILL_DIR = Path(__file__).resolve().parents[1]
PLUGIN_DIR = SKILL_DIR.parents[1]


@dataclass
class RuntimeConfig:
    base_url: str = DEFAULT_BASE_URL
    output_dir: Path = Path.cwd() / "data" / "supermind"
    token_file: Path | None = None
    initial_watch_seconds: int = 60


CONFIG = RuntimeConfig()
_USER_CACHE: str | None = None
_TOKEN_CACHE: str | None = None


class DriverError(RuntimeError):
    pass


def bj_now() -> str:
    return datetime.now(BJT).strftime("%Y-%m-%d %H:%M:%S 北京时间")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def bj(iso_utc: str | None) -> str:
    if not iso_utc:
        return "-"
    try:
        parsed = datetime.fromisoformat(iso_utc.replace("Z", "+00:00"))
        return parsed.astimezone(BJT).strftime("%Y-%m-%d %H:%M:%S 北京时间")
    except ValueError:
        return iso_utc


def token() -> str:
    global _TOKEN_CACHE
    if _TOKEN_CACHE is not None:
        return _TOKEN_CACHE
    value = os.environ.get("SUPERMIND_TOKEN", "").strip()
    if not value and CONFIG.token_file:
        try:
            value = CONFIG.token_file.expanduser().read_text(encoding="utf-8").strip()
        except FileNotFoundError as exc:
            raise DriverError(f"token file does not exist: {CONFIG.token_file}") from exc
    if not value:
        raise DriverError("set SUPERMIND_TOKEN or pass --token-file outside the plugin directory")
    _TOKEN_CACHE = value
    return value


def redact(value: object) -> str:
    text = str(value)
    if _TOKEN_CACHE:
        text = text.replace(_TOKEN_CACHE, "<redacted>")
        text = text.replace(urllib.parse.quote(_TOKEN_CACHE, safe=""), "<redacted>")
    return text


def api(
    method: str,
    path: str,
    data: Any = None,
    *,
    raw: bool = False,
    timeout: int = 30,
) -> Any:
    request = urllib.request.Request(
        CONFIG.base_url.rstrip("/") + path,
        method=method,
        headers={
            "Authorization": "token " + token(),
            "Content-Type": "application/json",
        },
        data=json.dumps(data).encode() if data is not None else None,
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read()
    if raw:
        return body
    return json.loads(body) if body else None


def hub_user() -> dict[str, Any]:
    info = api("GET", "/hub/api/user")
    if not isinstance(info, dict) or not info.get("name"):
        raise DriverError("SuperMind did not return an authenticated JupyterHub user")
    return info


def user_name() -> str:
    global _USER_CACHE
    if _USER_CACHE is None:
        _USER_CACHE = str(hub_user()["name"])
    return _USER_CACHE


def user_path(path: str) -> str:
    encoded = urllib.parse.quote(user_name(), safe="")
    return f"/user/{encoded}{path}"


def state_path() -> Path:
    return CONFIG.output_dir / ".runstate.json"


def _save_state(state: dict[str, Any]) -> None:
    CONFIG.output_dir.mkdir(parents=True, exist_ok=True)
    path = state_path()
    temporary = path.with_name(f".runstate.{uuid.uuid4().hex}.tmp")
    try:
        temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(path)
    finally:
        if temporary.exists():
            temporary.unlink()


def _load_state() -> dict[str, Any] | None:
    path = state_path()
    if not path.exists():
        return None
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise DriverError(f"invalid run state: {path}")
    return value


def _is_within(path: Path, directory: Path) -> bool:
    try:
        path.resolve().relative_to(directory.resolve())
        return True
    except ValueError:
        return False


def _parse_utc_timestamp(value: Any, label: str) -> datetime:
    if not isinstance(value, str) or not value.strip():
        raise DriverError(f"{label} is missing or invalid")
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError as exc:
        raise DriverError(f"{label} is not a valid ISO-8601 timestamp") from exc
    if parsed.tzinfo is None:
        raise DriverError(f"{label} must include a timezone")
    return parsed.astimezone(timezone.utc)


def acquire_account_run_lock() -> Any:
    identity = f"{CONFIG.base_url}|{user_name()}".encode("utf-8")
    digest = hashlib.sha256(identity).hexdigest()[:20]
    path = Path(tempfile.gettempdir()) / f"cosmos-stockdata-{digest}.lock"
    handle = path.open("a+b")
    try:
        try:
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            backend = "fcntl"
        except ImportError:  # pragma: no cover - exercised on Windows
            import msvcrt

            if path.stat().st_size == 0:
                handle.write(b"\0")
                handle.flush()
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            backend = "msvcrt"
    except (BlockingIOError, OSError) as exc:
        handle.close()
        raise DriverError(
            "another local process is already preparing or submitting a run for this SuperMind account"
        ) from exc
    except BaseException:
        handle.close()
        raise
    return handle, backend


def release_account_run_lock(lock: Any) -> None:
    handle, backend = lock
    try:
        if backend == "fcntl":
            import fcntl

            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        else:  # pragma: no cover - exercised on Windows
            import msvcrt

            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
    finally:
        handle.close()


def start_server() -> None:
    info = hub_user()
    name = str(info["name"])
    global _USER_CACHE
    _USER_CACHE = name
    if info.get("server"):
        print("服务器已在运行:", info["server"])
        return
    encoded = urllib.parse.quote(name, safe="")
    try:
        api("POST", f"/hub/api/users/{encoded}/server")
    except urllib.error.HTTPError as exc:
        if exc.code != 400:
            raise
    for _ in range(60):
        time.sleep(2)
        info = hub_user()
        if info.get("server") and not info.get("pending"):
            try:
                api("GET", user_path("/api/contents/?content=0"))
                print("服务器已启动:", info["server"])
                return
            except urllib.error.HTTPError:
                continue
    raise DriverError("SuperMind server start timed out after 120 seconds")


def stop_server() -> None:
    encoded = urllib.parse.quote(user_name(), safe="")
    try:
        api("DELETE", f"/hub/api/users/{encoded}/server")
        print("已请求停止服务器")
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            print("服务器本就未运行")
            return
        raise


def kernels() -> list[dict[str, Any]]:
    try:
        result = api("GET", user_path("/api/kernels"))
    except urllib.error.HTTPError as exc:
        if exc.code in {404, 503}:
            return []
        raise
    return result if isinstance(result, list) else []


def status() -> None:
    info = hub_user()
    print("服务器:", info.get("server") or "未运行", f"(pending: {info.get('pending')})")
    if info.get("server"):
        active = kernels()
        for kernel in active:
            print(
                "kernel: %s  state=%s  last=%s"
                % (
                    kernel["id"][:8],
                    kernel["execution_state"],
                    bj(kernel.get("last_activity")),
                )
            )
        if not active:
            print("kernel: 无")
        for item in cloud_workbooks():
            print("云端文件: %s  (modified %s)" % (item["name"], bj(item.get("last_modified"))))
    if state_path().exists():
        print("上次触发:", state_path().read_text(encoding="utf-8").strip())


def load_notebook() -> dict[str, Any]:
    notebook = json.loads(PACKAGED_NOTEBOOK.read_text(encoding="utf-8"))
    if not isinstance(notebook, dict) or not isinstance(notebook.get("cells"), list):
        raise DriverError(f"invalid notebook: {PACKAGED_NOTEBOOK}")
    return notebook


def _cell_source(cell: dict[str, Any]) -> str:
    source = cell.get("source", "")
    return "".join(source) if isinstance(source, list) else str(source)


def _set_cell_source(cell: dict[str, Any], source: str) -> None:
    cell["source"] = source.splitlines(keepends=True) if isinstance(cell.get("source"), list) else source


def require_default_target(notebook: dict[str, Any]) -> None:
    matches = sum(
        len(re.findall(r"(?m)^TARGET_DATE\s*=\s*None\b", _cell_source(cell)))
        for cell in notebook["cells"]
        if cell.get("cell_type") == "code"
    )
    if matches != 1:
        raise DriverError("packaged notebook must contain exactly one TARGET_DATE = None assignment")


def validate_date(value: str) -> str:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date().isoformat()
    except ValueError as exc:
        raise DriverError("date must be a real YYYY-MM-DD calendar date") from exc


def notebook_for_date(notebook: dict[str, Any], target_date: str) -> dict[str, Any]:
    target_date = validate_date(target_date)
    clone = copy.deepcopy(notebook)
    replacements = 0
    for cell in clone["cells"]:
        if cell.get("cell_type") != "code":
            continue
        source = _cell_source(cell)
        updated, count = re.subn(
            r"(?m)^TARGET_DATE\s*=\s*None[^\n]*",
            f"TARGET_DATE = {target_date!r}",
            source,
            count=1,
        )
        if count:
            _set_cell_source(cell, updated)
            replacements += count
    if replacements != 1:
        raise DriverError("could not create a single in-memory TARGET_DATE override")
    return clone


def notebook_codes(notebook: dict[str, Any]) -> list[str]:
    return [
        source
        for cell in notebook["cells"]
        if cell.get("cell_type") == "code"
        if (source := _cell_source(cell).strip())
    ]


def strip_outputs(notebook: dict[str, Any]) -> dict[str, Any]:
    clean = copy.deepcopy(notebook)
    for cell in clean.get("cells", []):
        if cell.get("cell_type") == "code":
            cell["outputs"] = []
            cell["execution_count"] = None
    return clean


def push_notebook(notebook: dict[str, Any]) -> None:
    path = user_path("/api/contents/" + urllib.parse.quote(NOTEBOOK_NAME))
    api("PUT", path, {"type": "notebook", "format": "json", "content": notebook})


def push() -> None:
    notebook = load_notebook()
    require_default_target(notebook)
    push_notebook(notebook)
    print("已推送 packaged notebook -> 云端", NOTEBOOK_NAME)


def pull(output: Path, force: bool = False) -> None:
    output = output.expanduser().resolve()
    if _is_within(output, PLUGIN_DIR):
        raise DriverError("pull output must be outside the installed plugin directory")
    if output.exists() and not force:
        raise DriverError(f"refusing to replace existing file without --force: {output}")
    response = api("GET", user_path("/api/contents/" + urllib.parse.quote(NOTEBOOK_NAME)))
    notebook = strip_outputs(response["content"])
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(notebook, ensure_ascii=False, indent=1), encoding="utf-8")
    print("已拉取云端 notebook 快照 ->", output)


def _ws_connect(kernel_id: str, timeout: int = 30) -> Any:
    try:
        import websocket
    except ImportError as exc:
        raise DriverError("websocket-client is required; install the bundled requirements.txt") from exc
    secret = token()
    query = urllib.parse.urlencode({"token": secret})
    url = CONFIG.base_url.replace("https://", "wss://", 1).replace("http://", "ws://", 1)
    url += user_path(f"/api/kernels/{kernel_id}/channels") + "?" + query
    try:
        return websocket.create_connection(
            url,
            timeout=timeout,
            header=["Authorization: token " + secret],
        )
    except Exception as exc:
        raise DriverError(f"websocket connection failed: {redact(exc)}") from exc


def _exec_message(code: str, session: str) -> str:
    return json.dumps(
        {
            "header": {
                "msg_id": uuid.uuid4().hex,
                "username": "stockdata-fetch",
                "session": session,
                "msg_type": "execute_request",
                "version": "5.2",
            },
            "parent_header": {},
            "metadata": {},
            "content": {
                "code": code,
                "silent": False,
                "store_history": True,
                "user_expressions": {},
                "allow_stdin": False,
            },
            "channel": "shell",
        }
    )


def _print_iopub(message: dict[str, Any]) -> None:
    kind = message.get("msg_type")
    content = message.get("content", {})
    if kind == "stream":
        sys.stdout.write(redact(content.get("text", "")))
        sys.stdout.flush()
    elif kind == "execute_result":
        print(redact(content.get("data", {}).get("text/plain", "")))
    elif kind == "error":
        print(
            "!! 远端报错: %s: %s"
            % (redact(content.get("ename")), redact(content.get("evalue")))
        )


def _initial_monitor(ws: Any, seconds: int) -> None:
    if seconds <= 0:
        return
    try:
        import websocket
    except ImportError as exc:  # pragma: no cover - _ws_connect already checks
        raise DriverError("websocket-client is required") from exc
    ws.settimeout(5)
    deadline = time.time() + seconds
    while time.time() < deadline:
        try:
            _print_iopub(json.loads(ws.recv()))
        except websocket.WebSocketTimeoutException:
            continue


def delete_kernel(kernel_id: str) -> None:
    try:
        api("DELETE", user_path(f"/api/kernels/{kernel_id}"))
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return
        raise DriverError(f"failed to delete kernel {kernel_id}: {redact(exc)}") from exc
    except Exception as exc:
        raise DriverError(f"failed to delete kernel {kernel_id}: {redact(exc)}") from exc


def cloud_workbooks() -> list[dict[str, Any]]:
    root = api("GET", user_path("/api/contents/?content=1"))
    content = root.get("content", []) if isinstance(root, dict) else []
    return sorted(
        (
            item
            for item in content
            if isinstance(item, dict)
            and re.fullmatch(r"supermind_full_\d{8}\.xlsx", str(item.get("name", "")))
        ),
        key=lambda item: item["name"],
    )


def run(target_date: str | None = None) -> None:
    canonical = load_notebook()
    require_default_target(canonical)
    target_date = validate_date(target_date) if target_date else None
    submitted_notebook = notebook_for_date(canonical, target_date) if target_date else canonical

    start_server()
    run_lock = acquire_account_run_lock()
    try:
        busy = [
            kernel
            for kernel in kernels()
            if kernel.get("execution_state") in {"busy", "starting", "restarting"}
        ]
        if busy:
            raise DriverError(
                "a SuperMind kernel is already busy; use watch/status instead of starting a duplicate run"
            )

        run_state: dict[str, Any] = {
            "run_id": uuid.uuid4().hex,
            "phase": "preparing",
            "kernel": None,
            "target_date": target_date,
            "fired_at_utc": utc_now(),
            "baseline_versions": {
                item["name"]: item.get("last_modified") for item in cloud_workbooks()
            },
        }
        _save_state(run_state)
    except BaseException:
        release_account_run_lock(run_lock)
        raise
    kernel_id: str | None = None
    ws = None
    submitted_state_saved = False
    override_may_exist = bool(target_date)
    canonical_restored = not target_date
    primary_error: BaseException | None = None
    restore_error: BaseException | None = None
    cleanup_error: BaseException | None = None
    try:
        push_notebook(submitted_notebook)
        print("已推送运行副本 -> 云端", NOTEBOOK_NAME)
        kernel = api("POST", user_path("/api/kernels"), {"name": "python3"})
        kernel_id = kernel["id"]
        print("kernel:", kernel_id)
        run_state.update({"phase": "submitting", "kernel": kernel_id})
        _save_state(run_state)
        ws = _ws_connect(kernel_id)
        session = uuid.uuid4().hex
        codes = notebook_codes(submitted_notebook)
        for code in codes:
            ws.send(_exec_message(code, session))
        run_state["phase"] = "submitted"
        _save_state(run_state)
        submitted_state_saved = True

        if target_date:
            try:
                push_notebook(canonical)
                canonical_restored = True
                print("已恢复云端 packaged notebook 的 TARGET_DATE = None")
            except BaseException as exc:
                restore_error = exc
                raise

        print(f"已提交 {len(codes)} 个单元格, 先守 {CONFIG.initial_watch_seconds} 秒确认启动...")
        _initial_monitor(ws, CONFIG.initial_watch_seconds)
    except BaseException as exc:
        primary_error = exc
    finally:
        if ws is not None:
            try:
                ws.close()
            except Exception as exc:
                print(f"!! websocket 关闭失败: {redact(exc)}", file=sys.stderr)
        if override_may_exist and not canonical_restored:
            try:
                push_notebook(canonical)
                canonical_restored = True
                print("已在失败清理中恢复云端 TARGET_DATE = None")
            except BaseException as exc:
                restore_error = exc
        if kernel_id and (not submitted_state_saved or restore_error is not None):
            if submitted_state_saved:
                run_state["phase"] = "aborted"
                try:
                    _save_state(run_state)
                except BaseException as exc:
                    cleanup_error = exc
            try:
                delete_kernel(kernel_id)
            except BaseException as exc:
                if cleanup_error is None:
                    cleanup_error = exc
        try:
            release_account_run_lock(run_lock)
        except BaseException as exc:
            if cleanup_error is None:
                cleanup_error = exc

    if cleanup_error is not None:
        raise DriverError(f"run cleanup failed: {redact(cleanup_error)}") from (
            primary_error or cleanup_error
        )
    if restore_error is not None:
        if canonical_restored:
            raise DriverError(
                "cloud notebook restore initially failed; the canonical notebook was restored on retry "
                "and the submitted kernel was aborted"
            ) from (primary_error or restore_error)
        raise DriverError(
            "historical-date cleanup failed; cloud notebook may retain the override. "
            "Do not run another extraction until `push` succeeds."
        ) from (primary_error or restore_error)
    if primary_error is not None:
        raise primary_error.with_traceback(primary_error.__traceback__)
    print("\n已脱开。全程约 25 分钟；用 watch 查看进度，再用 fetch 下载并验证。")


def watch(seconds: int = 2400) -> None:
    completed = False
    active = kernels()
    if not active:
        print("无 kernel 在运行（可能已完成或未触发）")
        return
    state = _load_state()
    kernel_id = state.get("kernel") if state else None
    if not kernel_id:
        raise DriverError("no extraction kernel is recorded in the current run state")
    if not any(kernel["id"] == kernel_id for kernel in active):
        print("runstate 记录的提取 kernel 已不在运行；请直接使用 fetch 检查结果。")
        return
    try:
        import websocket
    except ImportError as exc:
        raise DriverError("websocket-client is required; install the bundled requirements.txt") from exc
    ws = _ws_connect(kernel_id)
    ws.settimeout(5)
    deadline = time.time() + seconds
    primary_error: BaseException | None = None
    close_error: BaseException | None = None
    try:
        while time.time() < deadline:
            try:
                _print_iopub(json.loads(ws.recv()))
            except websocket.WebSocketTimeoutException:
                states = {kernel["id"]: kernel["execution_state"] for kernel in kernels()}
                if states.get(kernel_id) == "idle":
                    completed = True
                    break
        if not completed:
            raise DriverError(f"watch timed out after {seconds} seconds")
    except BaseException as exc:
        primary_error = exc
    finally:
        try:
            ws.close()
        except BaseException as exc:
            close_error = exc
    if completed:
        try:
            delete_kernel(kernel_id)
        except BaseException as exc:
            raise DriverError(f"kernel cleanup failed: {redact(exc)}") from (close_error or exc)
        if close_error is not None:
            raise DriverError(f"websocket close failed: {redact(close_error)}") from close_error
        print("\nkernel 已空闲并已清理；最终成败仍以 fetch 的本地验证为准。")
    elif close_error is not None:
        raise DriverError(f"websocket close failed: {redact(close_error)}") from (
            primary_error or close_error
        )
    if primary_error is not None:
        raise primary_error.with_traceback(primary_error.__traceback__)


def _normalize_fetch_date(value: str | None) -> str | None:
    if value is None:
        return None
    compact = value.replace("-", "")
    try:
        return datetime.strptime(compact, "%Y%m%d").strftime("%Y%m%d")
    except ValueError as exc:
        raise DriverError("fetch date must be YYYYMMDD or YYYY-MM-DD") from exc


def _require_fresh_result(item: dict[str, Any], state: dict[str, Any] | None) -> None:
    if state is None:
        raise DriverError("no run state is available; use --allow-existing for an existing cloud result")
    if state.get("phase") != "submitted":
        raise DriverError("the latest run was not fully submitted; refusing to accept a cloud workbook")
    target_date = state.get("target_date")
    if target_date:
        expected_name = f"supermind_full_{target_date.replace('-', '')}.xlsx"
        if item["name"] != expected_name:
            raise DriverError(
                f"cloud workbook {item['name']} does not match the latest run target {target_date}"
            )
    baseline = state.get("baseline_versions")
    if not isinstance(baseline, dict):
        raise DriverError("run state lacks cloud baseline versions; use --allow-existing only if intentional")
    old_version = baseline.get(item["name"])
    new_version = item.get("last_modified")
    new_time = _parse_utc_timestamp(new_version, "cloud workbook last_modified")
    fired_time = _parse_utc_timestamp(state.get("fired_at_utc"), "run fired_at_utc")
    if new_time <= fired_time:
        raise DriverError(
            "cloud workbook was not modified after this run started; refusing to treat it as fresh"
        )
    if item["name"] in baseline:
        old_time = _parse_utc_timestamp(old_version, "baseline last_modified")
        if new_time <= old_time:
            raise DriverError(
                "cloud workbook is not newer than its pre-run version; refusing to treat it as fresh"
            )


def fetch(target_date: str | None = None, *, allow_existing: bool = False) -> Path:
    start_server()
    compact = _normalize_fetch_date(target_date)
    state = _load_state()
    if compact is None and not allow_existing and state and state.get("target_date"):
        compact = _normalize_fetch_date(state["target_date"])
    files = cloud_workbooks()
    if compact:
        files = [item for item in files if compact in item["name"]]
    if not files:
        raise DriverError("cloud has no matching supermind_full_YYYYMMDD.xlsx")

    item = files[-1]
    if not allow_existing:
        _require_fresh_result(item, state)
    name = item["name"]
    ymd = re.search(r"(\d{8})", name).group(1)
    day = datetime.strptime(ymd, "%Y%m%d").date().isoformat()
    day_dir = CONFIG.output_dir / day
    day_dir.mkdir(parents=True, exist_ok=True)
    destination = day_dir / name
    temporary = day_dir / f".{name.removesuffix('.xlsx')}.{uuid.uuid4().hex}.download.xlsx"
    try:
        data = api("GET", user_path("/files/" + urllib.parse.quote(name)), raw=True, timeout=300)
        temporary.write_bytes(data)
        try:
            result = validate_workbook(
                temporary,
                expected_date=day,
                notebook_path=PACKAGED_NOTEBOOK,
            )
            print_result(result)
            if not result.passed:
                raise DriverError("downloaded workbook failed validation")
        except Exception as exc:
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            diagnostic = day_dir / (
                f"{name.removesuffix('.xlsx')}.invalid-{stamp}-{uuid.uuid4().hex[:8]}.xlsx"
            )
            temporary.replace(diagnostic)
            raise DriverError(
                f"downloaded workbook failed validation; diagnostic retained at {diagnostic}"
            ) from exc
        temporary.replace(destination)
    except BaseException:
        if temporary.exists():
            temporary.unlink()
        raise
    print("已下载并验证 %s -> %s (%.1f MB)" % (name, destination, len(data) / 1e6))
    return destination


def exec_code(code: str, timeout: int = 120) -> None:
    try:
        import websocket
    except ImportError as exc:
        raise DriverError("websocket-client is required; install the bundled requirements.txt") from exc

    start_server()
    kernel = api("POST", user_path("/api/kernels"), {"name": "python3"})
    kernel_id = kernel["id"]
    ws = None
    primary_error: BaseException | None = None
    try:
        ws = _ws_connect(kernel_id)
        session = uuid.uuid4().hex
        ws.send(_exec_message(code, session))
        ws.settimeout(5)
        deadline = time.time() + timeout
        done = False
        while not done and time.time() < deadline:
            try:
                message = json.loads(ws.recv())
            except websocket.WebSocketTimeoutException:
                continue
            if message.get("channel") == "iopub":
                _print_iopub(message)
            if message.get("msg_type") == "execute_reply":
                status_value = message["content"]["status"]
                print(f"[{status_value}]")
                if status_value != "ok":
                    raise DriverError(f"remote execution returned status={status_value}")
                done = True
        if not done:
            raise DriverError(f"exec timed out after {timeout} seconds")
    except BaseException as exc:
        primary_error = exc
    finally:
        if ws is not None:
            try:
                ws.close()
            except BaseException as exc:
                if primary_error is None:
                    primary_error = exc
        try:
            delete_kernel(kernel_id)
        except BaseException as exc:
            raise DriverError(f"kernel cleanup failed: {redact(exc)}") from (primary_error or exc)
    if primary_error is not None:
        raise primary_error.with_traceback(primary_error.__traceback__)


def build_parser() -> argparse.ArgumentParser:
    default_token_file = os.environ.get("SUPERMIND_TOKEN_FILE")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--base-url",
        default=os.environ.get("SUPERMIND_BASE_URL", DEFAULT_BASE_URL),
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(os.environ.get("STOCKDATA_OUTPUT_DIR", Path.cwd() / "data" / "supermind")),
    )
    parser.add_argument("--token-file", type=Path, default=Path(default_token_file) if default_token_file else None)
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("status")
    subparsers.add_parser("start-server")
    subparsers.add_parser("stop-server")
    subparsers.add_parser("push")

    pull_parser = subparsers.add_parser("pull")
    pull_parser.add_argument("--output", type=Path, required=True)
    pull_parser.add_argument("--force", action="store_true")

    run_parser = subparsers.add_parser("run")
    run_parser.add_argument("--date", help="Explicit Beijing trading date in YYYY-MM-DD form")
    run_parser.add_argument("--initial-watch-seconds", type=int, default=60)

    watch_parser = subparsers.add_parser("watch")
    watch_parser.add_argument("--seconds", type=int, default=2400)

    fetch_parser = subparsers.add_parser("fetch")
    fetch_parser.add_argument("--date", help="YYYYMMDD or YYYY-MM-DD; default is latest cloud file")
    fetch_parser.add_argument(
        "--allow-existing",
        action="store_true",
        help="Intentionally download a pre-existing cloud workbook without freshness proof",
    )

    exec_parser = subparsers.add_parser("exec")
    exec_parser.add_argument("code")
    exec_parser.add_argument("--timeout", type=int, default=120)
    return parser


def configure(args: argparse.Namespace) -> None:
    global CONFIG, _USER_CACHE, _TOKEN_CACHE
    output_dir = args.output_dir.expanduser().resolve()
    token_file = args.token_file.expanduser().resolve() if args.token_file else None
    if _is_within(output_dir, PLUGIN_DIR):
        raise DriverError("output directory must be outside the installed plugin directory")
    if token_file and _is_within(token_file, PLUGIN_DIR):
        raise DriverError("token file must be outside the installed plugin directory")
    if token_file and _is_within(token_file, output_dir):
        raise DriverError("token file must be outside the output directory")
    CONFIG = RuntimeConfig(
        base_url=args.base_url.rstrip("/"),
        output_dir=output_dir,
        token_file=token_file,
        initial_watch_seconds=getattr(args, "initial_watch_seconds", 60),
    )
    _USER_CACHE = None
    _TOKEN_CACHE = None


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        configure(args)
        if args.command == "status":
            status()
        elif args.command == "start-server":
            start_server()
        elif args.command == "stop-server":
            stop_server()
        elif args.command == "push":
            push()
        elif args.command == "pull":
            pull(args.output, force=args.force)
        elif args.command == "run":
            run(args.date)
        elif args.command == "watch":
            watch(args.seconds)
        elif args.command == "fetch":
            fetch(args.date, allow_existing=args.allow_existing)
        elif args.command == "exec":
            exec_code(args.code, timeout=args.timeout)
    except KeyboardInterrupt:
        print("ERROR: interrupted", file=sys.stderr)
        return 130
    except Exception as exc:
        print(f"ERROR: {redact(exc)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
