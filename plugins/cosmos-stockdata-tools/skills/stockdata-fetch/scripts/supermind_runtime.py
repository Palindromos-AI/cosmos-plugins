#!/usr/bin/env python3
"""Generic SuperMind JupyterHub runtime for external stockdata workspace scripts."""

from __future__ import annotations

import argparse
import importlib
import importlib.metadata
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
from pathlib import Path
from typing import Any, NamedTuple


DEFAULT_BASE_URL = "https://supermind.10jqka.com.cn/notebook"
DEFAULT_CONFIG_FILE = Path.home() / ".config" / "cosmos-stockdata-tools" / "runtime.json"
SKILL_DIR = Path(__file__).resolve().parents[1]
PLUGIN_DIR = SKILL_DIR.parents[1]
EXPECTED_WEBSOCKET_VERSION = "1.8.0"

_TOKEN_CACHE: str | None = None
_USER_CACHE: str | None = None


class RuntimeError(Exception):
    """A safe, user-facing runtime failure."""


class ApiError(RuntimeError):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status


class RejectRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(
        self,
        req: urllib.request.Request,
        fp: Any,
        code: int,
        msg: str,
        headers: Any,
        newurl: str,
    ) -> None:
        return None


_HTTP_OPENER = urllib.request.build_opener(RejectRedirects())


class RuntimeBinding(NamedTuple):
    workspace: Path
    token_file: Path
    micromamba_env: str


def is_within(path: Path, directory: Path) -> bool:
    try:
        path.resolve().relative_to(directory.resolve())
        return True
    except ValueError:
        return False


def require_absolute(path: Path, label: str) -> Path:
    if not path.is_absolute():
        raise RuntimeError(f"{label} must be an absolute path: {path}")
    return path.expanduser().resolve()


def is_temporary_workspace(path: Path) -> bool:
    temporary_roots = {
        Path(tempfile.gettempdir()).resolve(),
        Path("/tmp").resolve(),
        Path("/private/tmp").resolve(),
        Path("/var/tmp").resolve(),
    }
    return any(is_within(path, root) for root in temporary_roots)


def validate_binding(binding: RuntimeBinding) -> RuntimeBinding:
    workspace = require_absolute(binding.workspace, "workspace")
    token_file = require_absolute(binding.token_file, "token file")
    environment = binding.micromamba_env.strip()
    if not environment or not re.fullmatch(r"[A-Za-z0-9_.-]+", environment):
        raise RuntimeError("micromamba environment must be a non-empty environment name")
    if not workspace.is_dir():
        raise RuntimeError(f"workspace directory does not exist: {workspace}")
    if is_temporary_workspace(workspace):
        raise RuntimeError("workspace must be durable and outside OS temporary directories")
    if is_within(workspace, PLUGIN_DIR):
        raise RuntimeError("workspace must be outside the installed plugin")
    if not token_file.is_file():
        raise RuntimeError(f"token file does not exist: {token_file}")
    if is_within(token_file, workspace):
        raise RuntimeError("token file must remain outside the stockdata workspace")
    if is_within(token_file, PLUGIN_DIR):
        raise RuntimeError("token file must be outside the installed plugin")
    if os.name == "posix" and token_file.stat().st_mode & 0o777 != 0o600:
        raise RuntimeError(f"token file permissions must be 600: {token_file}")
    return RuntimeBinding(workspace, token_file, environment)


def atomic_write_config(config_file: Path, binding: RuntimeBinding) -> None:
    config_file = require_absolute(config_file, "config file")
    if is_within(config_file, PLUGIN_DIR) or is_within(config_file, binding.workspace):
        raise RuntimeError("runtime config must be outside the plugin and stockdata workspace")
    parent_existed = config_file.parent.exists()
    config_file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if os.name == "posix" and not parent_existed:
        config_file.parent.chmod(0o700)
    temporary = config_file.with_name(f".{config_file.name}.{uuid.uuid4().hex}.tmp")
    payload = {
        "workspace": str(binding.workspace),
        "token_file": str(binding.token_file),
        "micromamba_env": binding.micromamba_env,
    }
    try:
        temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
        if os.name == "posix":
            temporary.chmod(0o600)
        temporary.replace(config_file)
    finally:
        if temporary.exists():
            temporary.unlink()


def configure_runtime(
    config_file: Path,
    workspace: Path,
    token_file: Path,
    micromamba_env: str,
    *,
    allow_reconfigure: bool = False,
) -> RuntimeBinding:
    binding = validate_binding(RuntimeBinding(workspace, token_file, micromamba_env))
    config_file = require_absolute(config_file, "config file")
    if config_file.exists():
        try:
            existing = load_binding(config_file)
        except RuntimeError as exc:
            if not allow_reconfigure:
                raise RuntimeError(
                    f"existing runtime config is invalid; inspect it and use --reconfigure "
                    f"only after explicit authorization: {exc}"
                ) from exc
        else:
            if existing == binding:
                return existing
            if not allow_reconfigure:
                raise RuntimeError(
                    "runtime binding already exists and differs from the requested values; "
                    "use --reconfigure only after explicit authorization"
                )
    atomic_write_config(config_file, binding)
    return binding


def load_binding(config_file: Path, *, verify_environment: bool = False) -> RuntimeBinding:
    config_file = require_absolute(config_file, "config file")
    try:
        payload = json.loads(config_file.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise RuntimeError(
            f"runtime config does not exist: {config_file}; run configure first"
        ) from exc
    except (json.JSONDecodeError, OSError) as exc:
        raise RuntimeError(f"cannot read runtime config {config_file}: {exc}") from exc
    if not isinstance(payload, dict):
        raise RuntimeError(f"runtime config must contain a JSON object: {config_file}")
    try:
        workspace_value = payload["workspace"]
        token_file_value = payload["token_file"]
        environment_value = payload["micromamba_env"]
        if not all(
            isinstance(value, str)
            for value in (workspace_value, token_file_value, environment_value)
        ):
            raise TypeError("all binding values must be strings")
        binding = RuntimeBinding(
            Path(workspace_value),
            Path(token_file_value),
            environment_value,
        )
    except (KeyError, TypeError) as exc:
        raise RuntimeError(f"runtime config has invalid or missing binding fields: {exc}") from exc
    binding = validate_binding(binding)
    active = os.environ.get("CONDA_DEFAULT_ENV", "").strip()
    if verify_environment and active != binding.micromamba_env:
        raise RuntimeError(
            "run this command in the configured micromamba environment "
            f"{binding.micromamba_env!r}; active environment is {active or 'unknown'!r}"
        )
    return binding


def read_token(token_file: Path) -> str:
    global _TOKEN_CACHE
    token_file = require_absolute(token_file, "token file")
    try:
        value = token_file.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise RuntimeError(f"cannot read token file {token_file}: {exc}") from exc
    if not value:
        raise RuntimeError(f"token file is empty: {token_file}")
    _TOKEN_CACHE = value
    return value


def token(binding: RuntimeBinding) -> str:
    return _TOKEN_CACHE if _TOKEN_CACHE is not None else read_token(binding.token_file)


def redact(value: object) -> str:
    text = str(value)
    if _TOKEN_CACHE:
        text = text.replace(_TOKEN_CACHE, "<redacted>")
        text = text.replace(urllib.parse.quote(_TOKEN_CACHE, safe=""), "<redacted>")
    return text


def require_websocket() -> Any:
    try:
        websocket = importlib.import_module("websocket")
        version = importlib.metadata.version("websocket-client")
    except Exception as exc:
        raise RuntimeError(
            f"websocket-client=={EXPECTED_WEBSOCKET_VERSION} is required: {exc}"
        ) from exc
    if version != EXPECTED_WEBSOCKET_VERSION:
        raise RuntimeError(
            f"websocket-client {version} is installed; expected {EXPECTED_WEBSOCKET_VERSION}"
        )
    for attribute in ("create_connection", "WebSocketTimeoutException"):
        if not hasattr(websocket, attribute):
            raise RuntimeError(f"websocket-client is missing required API: {attribute}")
    return websocket


def api(
    binding: RuntimeBinding,
    method: str,
    path: str,
    data: Any = None,
    *,
    raw: bool = False,
    timeout: int = 30,
) -> Any:
    request = urllib.request.Request(
        DEFAULT_BASE_URL.rstrip("/") + path,
        method=method,
        headers={
            "Authorization": "token " + token(binding),
            "Content-Type": "application/json",
        },
        data=json.dumps(data).encode("utf-8") if data is not None else None,
    )
    try:
        with _HTTP_OPENER.open(request, timeout=timeout) as response:
            body = response.read()
    except urllib.error.HTTPError as exc:
        raise ApiError(
            exc.code,
            f"SuperMind API request failed with HTTP {exc.code}: {redact(exc.reason)}",
        ) from exc
    except Exception as exc:
        raise RuntimeError(f"SuperMind API request failed: {redact(exc)}") from exc
    if raw:
        return body
    try:
        return json.loads(body) if body else None
    except json.JSONDecodeError as exc:
        raise RuntimeError("SuperMind API returned invalid JSON") from exc


def hub_user(binding: RuntimeBinding) -> dict[str, Any]:
    info = api(binding, "GET", "/hub/api/user")
    if not isinstance(info, dict) or not info.get("name"):
        raise RuntimeError("SuperMind did not return an authenticated JupyterHub user")
    return info


def user_name(binding: RuntimeBinding) -> str:
    global _USER_CACHE
    if _USER_CACHE is None:
        _USER_CACHE = str(hub_user(binding)["name"])
    return _USER_CACHE


def user_path(binding: RuntimeBinding, path: str) -> str:
    return f"/user/{urllib.parse.quote(user_name(binding), safe='')}{path}"


def start_server(binding: RuntimeBinding) -> None:
    info = hub_user(binding)
    global _USER_CACHE
    _USER_CACHE = str(info["name"])
    if info.get("server") and not info.get("pending"):
        return
    encoded = urllib.parse.quote(_USER_CACHE, safe="")
    try:
        api(binding, "POST", f"/hub/api/users/{encoded}/server")
    except ApiError as exc:
        if exc.status != 400:
            raise
    for _ in range(60):
        time.sleep(2)
        info = hub_user(binding)
        if info.get("server") and not info.get("pending"):
            try:
                api(binding, "GET", user_path(binding, "/api/contents/?content=0"))
                return
            except ApiError as exc:
                if exc.status not in {404, 503}:
                    raise
    raise RuntimeError("SuperMind server start timed out after 120 seconds")


def stop_server(binding: RuntimeBinding) -> None:
    encoded = urllib.parse.quote(user_name(binding), safe="")
    try:
        api(binding, "DELETE", f"/hub/api/users/{encoded}/server")
    except ApiError as exc:
        if exc.status != 404:
            raise


def list_kernels(binding: RuntimeBinding) -> list[dict[str, Any]]:
    try:
        result = api(binding, "GET", user_path(binding, "/api/kernels"))
    except ApiError as exc:
        if exc.status in {404, 503}:
            return []
        raise
    return result if isinstance(result, list) else []


def status(binding: RuntimeBinding) -> None:
    info = hub_user(binding)
    print(f"server: {info.get('server') or 'stopped'}")
    print(f"pending: {info.get('pending') or 'none'}")
    for kernel in list_kernels(binding) if info.get("server") else []:
        print(
            "kernel: %s state=%s"
            % (str(kernel.get("id", "unknown")), kernel.get("execution_state", "unknown"))
        )


def delete_kernel(binding: RuntimeBinding, kernel_id: str) -> None:
    try:
        api(binding, "DELETE", user_path(binding, f"/api/kernels/{kernel_id}"))
    except ApiError as exc:
        if exc.status != 404:
            raise RuntimeError(f"failed to delete kernel {kernel_id}: {redact(exc)}") from exc


def connect_kernel(binding: RuntimeBinding, kernel_id: str, timeout: int) -> Any:
    websocket = require_websocket()
    secret = token(binding)
    query = urllib.parse.urlencode({"token": secret})
    url = DEFAULT_BASE_URL.replace("https://", "wss://", 1)
    url += user_path(binding, f"/api/kernels/{kernel_id}/channels") + "?" + query
    try:
        connection = websocket.create_connection(
            url,
            timeout=timeout,
            header=["Authorization: token " + secret],
            redirect_limit=0,
        )
        response = getattr(connection, "handshake_response", None)
        if response is not None and getattr(response, "status", 101) != 101:
            connection.close()
            raise RuntimeError("websocket redirect or non-upgrade response refused")
        return connection
    except Exception as exc:
        raise RuntimeError(f"websocket connection failed: {redact(exc)}") from exc


def execution_message(code: str) -> tuple[str, str]:
    message_id = uuid.uuid4().hex
    session = uuid.uuid4().hex
    message = {
        "header": {
            "msg_id": message_id,
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
            "store_history": False,
            "user_expressions": {},
            "allow_stdin": False,
            "stop_on_error": True,
        },
        "channel": "shell",
    }
    return json.dumps(message), message_id


def print_message(message: dict[str, Any]) -> None:
    kind = message.get("msg_type") or message.get("header", {}).get("msg_type")
    content = message.get("content", {})
    if kind == "stream":
        sys.stdout.write(redact(content.get("text", "")))
        sys.stdout.flush()
    elif kind in {"execute_result", "display_data"}:
        value = content.get("data", {}).get("text/plain")
        if value is not None:
            print(redact(value))
    elif kind == "error":
        print(
            f"remote error: {redact(content.get('ename', 'Error'))}: "
            f"{redact(content.get('evalue', ''))}",
            file=sys.stderr,
        )


def execute_code(binding: RuntimeBinding, code: str, timeout: int) -> None:
    websocket_module = require_websocket()
    start_server(binding)
    kernel_id: str | None = None
    connection = None
    primary_error: BaseException | None = None
    try:
        kernel = api(binding, "POST", user_path(binding, "/api/kernels"), {"name": "python3"})
        if not isinstance(kernel, dict) or not kernel.get("id"):
            raise RuntimeError("SuperMind did not return a kernel ID")
        kernel_id = str(kernel["id"])
        connection = connect_kernel(binding, kernel_id, timeout)
        request, message_id = execution_message(code)
        connection.send(request)
        connection.settimeout(min(5, timeout))
        deadline = time.monotonic() + timeout
        reply_received = False
        idle_received = False
        while time.monotonic() < deadline:
            try:
                message = json.loads(connection.recv())
            except websocket_module.WebSocketTimeoutException:
                continue
            except json.JSONDecodeError as exc:
                raise RuntimeError("SuperMind websocket returned invalid JSON") from exc
            if message.get("parent_header", {}).get("msg_id") != message_id:
                continue
            print_message(message)
            kind = message.get("msg_type") or message.get("header", {}).get("msg_type")
            if kind == "execute_reply":
                content = message.get("content", {})
                if content.get("status") != "ok":
                    raise RuntimeError(
                        "remote execution failed: "
                        f"{redact(content.get('ename', 'Error'))}: "
                        f"{redact(content.get('evalue', ''))}"
                    )
                reply_received = True
            elif kind == "status" and message.get("content", {}).get("execution_state") == "idle":
                idle_received = True
            if reply_received and idle_received:
                return
        raise RuntimeError(f"remote execution timed out after {timeout} seconds")
    except BaseException as exc:
        primary_error = exc
    finally:
        if connection is not None:
            try:
                connection.close()
            except Exception as exc:
                if primary_error is None:
                    primary_error = RuntimeError(f"websocket close failed: {redact(exc)}")
        if kernel_id is not None:
            try:
                delete_kernel(binding, kernel_id)
            except BaseException as exc:
                cleanup = RuntimeError(f"kernel cleanup failed for {kernel_id}: {redact(exc)}")
                if primary_error is None:
                    primary_error = cleanup
                else:
                    primary_error = RuntimeError(f"{redact(primary_error)}; {cleanup}")
    if primary_error is not None:
        raise primary_error


def download_file(
    binding: RuntimeBinding,
    remote_path: str,
    output: Path,
    *,
    force: bool,
) -> None:
    output = require_absolute(output, "download output")
    if is_within(output, PLUGIN_DIR):
        raise RuntimeError("download output must be outside the installed plugin")
    if output == binding.token_file.expanduser().resolve():
        raise RuntimeError("download output must never replace the configured token file")
    if is_within(output, DEFAULT_CONFIG_FILE.expanduser().resolve().parent):
        raise RuntimeError("download output must never replace stockdata runtime metadata")
    if output.exists() and not force:
        raise RuntimeError(f"refusing to replace existing file without --force: {output}")
    remote = remote_path.strip().lstrip("/")
    if not remote or remote.endswith("/"):
        raise RuntimeError("remote path must identify one file")
    start_server(binding)
    body = api(
        binding,
        "GET",
        user_path(binding, "/files/" + urllib.parse.quote(remote, safe="/")),
        raw=True,
        timeout=120,
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(f".{output.name}.{uuid.uuid4().hex}.download")
    try:
        temporary.write_bytes(body)
        temporary.replace(output)
    finally:
        if temporary.exists():
            temporary.unlink()


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    commands = result.add_subparsers(dest="command", required=True)

    configure = commands.add_parser("configure", help="persist per-user runtime metadata")
    configure.add_argument("--workspace", type=Path, required=True)
    configure.add_argument("--token-file", type=Path, required=True)
    configure.add_argument("--micromamba-env", required=True)
    configure.add_argument("--reconfigure", action="store_true")

    commands.add_parser("show-config", help="show metadata without revealing token contents")
    commands.add_parser("status")
    commands.add_parser("start-server")
    commands.add_parser("stop-server")

    execute = commands.add_parser("exec")
    execute.add_argument("code")
    execute.add_argument("--timeout", type=positive_int, default=600)

    execute_file = commands.add_parser("exec-file")
    execute_file.add_argument("file", type=Path)
    execute_file.add_argument("--timeout", type=positive_int, default=600)

    download = commands.add_parser("download")
    download.add_argument("remote_path")
    download.add_argument("--output", type=Path, required=True)
    download.add_argument("--force", action="store_true")
    return result


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return parsed


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        if args.command == "configure":
            binding = configure_runtime(
                DEFAULT_CONFIG_FILE,
                args.workspace,
                args.token_file,
                args.micromamba_env,
                allow_reconfigure=args.reconfigure,
            )
            print(f"configured workspace: {binding.workspace}")
            print(f"configured token file: {binding.token_file}")
            print(f"configured micromamba environment: {binding.micromamba_env}")
            return 0
        binding = load_binding(
            DEFAULT_CONFIG_FILE,
            verify_environment=args.command not in {"show-config"},
        )
        if args.command == "show-config":
            print(json.dumps(binding._asdict(), default=str, indent=2))
        elif args.command == "status":
            status(binding)
        elif args.command == "start-server":
            start_server(binding)
        elif args.command == "stop-server":
            stop_server(binding)
        elif args.command == "exec":
            execute_code(binding, args.code, args.timeout)
        elif args.command == "exec-file":
            source = require_absolute(args.file, "script file")
            if not is_within(source, binding.workspace):
                raise RuntimeError("exec-file must be inside the configured stockdata workspace")
            execute_code(binding, source.read_text(encoding="utf-8"), args.timeout)
        elif args.command == "download":
            download_file(binding, args.remote_path, args.output, force=args.force)
        return 0
    except BaseException as exc:
        print(f"error: {redact(exc)}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
