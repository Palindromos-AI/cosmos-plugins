from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import os
import stat
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "supermind_runtime.py"
SPEC = importlib.util.spec_from_file_location("supermind_runtime", SCRIPT)
assert SPEC and SPEC.loader
runtime = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runtime)


class FakeWebSocket:
    def __init__(self, received: list[str | BaseException]) -> None:
        self.received = list(received)
        self.sent: list[str] = []
        self.closed = False

    def send(self, value: str) -> None:
        self.sent.append(value)

    def recv(self) -> str:
        if not self.received:
            raise AssertionError("no queued websocket message")
        value = self.received.pop(0)
        if isinstance(value, BaseException):
            raise value
        return value

    def settimeout(self, _seconds: int) -> None:
        return None

    def close(self) -> None:
        self.closed = True


class RuntimeTests(unittest.TestCase):
    def setUp(self) -> None:
        runtime._TOKEN_CACHE = None
        runtime._USER_CACHE = None
        temporary_check = patch.object(runtime, "is_temporary_workspace", return_value=False)
        temporary_check.start()
        self.addCleanup(temporary_check.stop)

    def test_configure_persists_paths_and_environment_but_not_token(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            workspace = base / "workspace"
            workspace.mkdir()
            token_file = base / "credentials" / "token"
            token_file.parent.mkdir()
            token_file.write_text("private-token\n", encoding="utf-8")
            token_file.chmod(0o600)
            config_file = base / "config" / "runtime.json"

            binding = runtime.configure_runtime(
                config_file, workspace, token_file, "panda"
            )

            payload = json.loads(config_file.read_text(encoding="utf-8"))
            self.assertEqual(payload["workspace"], str(workspace.resolve()))
            self.assertEqual(payload["token_file"], str(token_file.resolve()))
            self.assertEqual(payload["micromamba_env"], "panda")
            self.assertNotIn("private-token", config_file.read_text(encoding="utf-8"))
            self.assertEqual(binding.micromamba_env, "panda")
            if os.name == "posix":
                self.assertEqual(stat.S_IMODE(config_file.stat().st_mode), 0o600)

    def test_configure_requires_absolute_paths(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            config = Path(root) / "runtime.json"
            with self.assertRaisesRegex(runtime.RuntimeError, "absolute"):
                runtime.configure_runtime(config, Path("workspace"), Path("token"), "panda")

    def test_configure_rejects_token_inside_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            workspace = Path(root) / "workspace"
            workspace.mkdir()
            token_file = workspace / "token"
            token_file.write_text("secret", encoding="utf-8")
            token_file.chmod(0o600)
            with self.assertRaisesRegex(runtime.RuntimeError, "outside the stockdata workspace"):
                runtime.configure_runtime(
                    Path(root) / "runtime.json", workspace, token_file, "panda"
                )

    def test_configure_refuses_silent_rebinding(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            first_workspace = base / "workspace-a"
            second_workspace = base / "workspace-b"
            first_workspace.mkdir()
            second_workspace.mkdir()
            token_file = base / "token"
            token_file.write_text("secret", encoding="utf-8")
            token_file.chmod(0o600)
            config = base / "runtime.json"
            runtime.configure_runtime(config, first_workspace, token_file, "panda")

            with self.assertRaisesRegex(runtime.RuntimeError, "--reconfigure"):
                runtime.configure_runtime(config, second_workspace, token_file, "panda")

            binding = runtime.configure_runtime(
                config,
                second_workspace,
                token_file,
                "panda",
                allow_reconfigure=True,
            )
            self.assertEqual(binding.workspace, second_workspace.resolve())

    def test_load_binding_rejects_wrong_environment(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            workspace = base / "workspace"
            workspace.mkdir()
            token_file = base / "token"
            token_file.write_text("secret", encoding="utf-8")
            token_file.chmod(0o600)
            config = base / "runtime.json"
            runtime.configure_runtime(config, workspace, token_file, "panda")
            with patch.dict(os.environ, {"CONDA_DEFAULT_ENV": "other"}, clear=False):
                with self.assertRaisesRegex(runtime.RuntimeError, "panda"):
                    runtime.load_binding(config, verify_environment=True)

    def test_token_reads_only_configured_file(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "token"
            path.write_text("file-token\n", encoding="utf-8")
            path.chmod(0o600)
            self.assertEqual(runtime.read_token(path), "file-token")

    def test_redact_removes_raw_and_url_encoded_token(self) -> None:
        runtime._TOKEN_CACHE = "secret/token"
        redacted = runtime.redact("secret/token secret%2Ftoken")
        self.assertNotIn("secret", redacted)
        self.assertEqual(redacted, "<redacted> <redacted>")

    def test_dependency_preflight_happens_before_remote_mutation(self) -> None:
        binding = SimpleNamespace(token_file=Path("/token"))
        with (
            patch.object(runtime, "require_websocket", side_effect=runtime.RuntimeError("missing")),
            patch.object(runtime, "start_server") as start,
        ):
            with self.assertRaisesRegex(runtime.RuntimeError, "missing"):
                runtime.execute_code(binding, "1 + 1", 30)
        start.assert_not_called()

    def test_execute_connection_failure_deletes_exact_created_kernel(self) -> None:
        binding = SimpleNamespace(token_file=Path("/token"))
        with (
            patch.object(runtime, "require_websocket"),
            patch.object(runtime, "start_server"),
            patch.object(runtime, "user_path", side_effect=lambda _binding, path: path),
            patch.object(runtime, "api", return_value={"id": "kernel-1"}),
            patch.object(runtime, "connect_kernel", side_effect=runtime.RuntimeError("connect")),
            patch.object(runtime, "delete_kernel") as delete,
        ):
            with self.assertRaisesRegex(runtime.RuntimeError, "connect"):
                runtime.execute_code(binding, "1 + 1", 30)
        delete.assert_called_once_with(binding, "kernel-1")

    def test_execute_remote_error_is_nonzero_and_deletes_kernel(self) -> None:
        reply = json.dumps(
            {
                "channel": "shell",
                "parent_header": {"msg_id": "message-1"},
                "msg_type": "execute_reply",
                "content": {"status": "error", "ename": "RuntimeError", "evalue": "boom"},
            }
        )
        websocket = FakeWebSocket([reply])
        binding = SimpleNamespace(token_file=Path("/token"))
        with (
            patch.object(runtime, "require_websocket", return_value=SimpleNamespace(WebSocketTimeoutException=TimeoutError)),
            patch.object(runtime, "start_server"),
            patch.object(runtime, "user_path", side_effect=lambda _binding, path: path),
            patch.object(runtime, "api", return_value={"id": "kernel-1"}),
            patch.object(runtime, "connect_kernel", return_value=websocket),
            patch.object(runtime, "execution_message", return_value=("request", "message-1")),
            patch.object(runtime, "delete_kernel") as delete,
        ):
            with self.assertRaisesRegex(runtime.RuntimeError, "RuntimeError: boom"):
                runtime.execute_code(binding, "raise RuntimeError('boom')", 30)
        self.assertTrue(websocket.closed)
        delete.assert_called_once_with(binding, "kernel-1")

    def test_execute_waits_for_reply_and_idle_then_deletes_kernel(self) -> None:
        reply = json.dumps(
            {
                "channel": "shell",
                "parent_header": {"msg_id": "message-1"},
                "msg_type": "execute_reply",
                "content": {"status": "ok"},
            }
        )
        idle = json.dumps(
            {
                "channel": "iopub",
                "parent_header": {"msg_id": "message-1"},
                "msg_type": "status",
                "content": {"execution_state": "idle"},
            }
        )
        websocket = FakeWebSocket([reply, idle])
        binding = SimpleNamespace(token_file=Path("/token"))
        with (
            patch.object(runtime, "require_websocket", return_value=SimpleNamespace(WebSocketTimeoutException=TimeoutError)),
            patch.object(runtime, "start_server"),
            patch.object(runtime, "user_path", side_effect=lambda _binding, path: path),
            patch.object(runtime, "api", return_value={"id": "kernel-1"}),
            patch.object(runtime, "connect_kernel", return_value=websocket),
            patch.object(runtime, "execution_message", return_value=("request", "message-1")),
            patch.object(runtime, "delete_kernel") as delete,
        ):
            runtime.execute_code(binding, "print('done')", 30)
        self.assertEqual(len(websocket.received), 0)
        self.assertTrue(websocket.closed)
        delete.assert_called_once_with(binding, "kernel-1")

    def test_stream_output_redacts_token(self) -> None:
        runtime._TOKEN_CACHE = "private-token"
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            runtime.print_message(
                {"msg_type": "stream", "content": {"text": "private-token\n"}}
            )
        self.assertEqual(output.getvalue(), "<redacted>\n")

    def test_status_does_not_print_account_name(self) -> None:
        binding = SimpleNamespace(token_file=Path("/token"))
        output = io.StringIO()
        with (
            patch.object(
                runtime,
                "hub_user",
                return_value={"name": "private-account", "server": None, "pending": None},
            ),
            contextlib.redirect_stdout(output),
        ):
            runtime.status(binding)
        self.assertNotIn("private-account", output.getvalue())

    def test_download_refuses_plugin_destination_and_existing_file(self) -> None:
        binding = SimpleNamespace(token_file=Path("/token"))
        plugin_target = runtime.PLUGIN_DIR / "result.bin"
        with self.assertRaisesRegex(runtime.RuntimeError, "outside the installed plugin"):
            runtime.download_file(binding, "result.bin", plugin_target, force=False)
        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / "result.bin"
            target.write_bytes(b"old")
            with self.assertRaisesRegex(runtime.RuntimeError, "--force"):
                runtime.download_file(binding, "result.bin", target, force=False)

    def test_download_never_overwrites_token_or_runtime_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            token_file = Path(root) / "token"
            binding = SimpleNamespace(token_file=token_file)
            with self.assertRaisesRegex(runtime.RuntimeError, "token file"):
                runtime.download_file(binding, "result.bin", token_file, force=True)
            with (
                patch.object(
                    runtime,
                    "DEFAULT_CONFIG_FILE",
                    Path(root) / "config" / "runtime.json",
                ),
                self.assertRaisesRegex(runtime.RuntimeError, "runtime metadata"),
            ):
                runtime.download_file(
                    binding,
                    "result.bin",
                    Path(root) / "config" / "other-runtime-metadata",
                    force=True,
                )

    def test_http_redirect_handler_refuses_redirects(self) -> None:
        handler = runtime.RejectRedirects()
        self.assertIsNone(
            handler.redirect_request(
                SimpleNamespace(),
                None,
                302,
                "Found",
                {},
                "https://attacker.example/token",
            )
        )

    def test_websocket_disables_redirects(self) -> None:
        binding = SimpleNamespace(token_file=Path("/token"))
        connection = SimpleNamespace(
            handshake_response=SimpleNamespace(status=101),
        )
        websocket = SimpleNamespace(create_connection=lambda *_args, **_kwargs: connection)
        with (
            patch.object(runtime, "require_websocket", return_value=websocket),
            patch.object(runtime, "token", return_value="secret"),
            patch.object(runtime, "user_path", return_value="/user/alice/api/kernels/k/channels"),
            patch.object(websocket, "create_connection", return_value=connection) as connect,
        ):
            self.assertIs(runtime.connect_kernel(binding, "k", 30), connection)
        self.assertEqual(connect.call_args.kwargs["redirect_limit"], 0)


if __name__ == "__main__":
    unittest.main()
