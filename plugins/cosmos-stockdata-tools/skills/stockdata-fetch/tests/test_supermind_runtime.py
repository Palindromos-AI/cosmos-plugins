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

REAL_IS_TEMPORARY_WORKSPACE = runtime.is_temporary_workspace


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


class TimeoutOnlyWebSocket(FakeWebSocket):
    def recv(self) -> str:
        raise TimeoutError()


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
            workspace_root = base / "cosmos-workspace"
            workspace_root.mkdir()
            token_file = base / "credentials" / "token"
            token_file.parent.mkdir()
            token_file.write_text("private-token\n", encoding="utf-8")
            token_file.chmod(0o600)
            config_file = base / "config" / "runtime.json"

            binding = runtime.configure_runtime(
                config_file, workspace_root, token_file, "cosmos"
            )

            payload = json.loads(config_file.read_text(encoding="utf-8"))
            self.assertEqual(payload["schema_version"], 1)
            self.assertEqual(payload["plugin"], "cosmos-stockdata-tools")
            self.assertEqual(payload["workspace_root"], str(workspace_root.resolve()))
            self.assertEqual(
                payload["workspace"], str((workspace_root / "stockdata").resolve())
            )
            self.assertEqual(payload["token_file"], str(token_file.resolve()))
            self.assertEqual(payload["micromamba_env"], "cosmos")
            self.assertNotIn("private-token", config_file.read_text(encoding="utf-8"))
            self.assertEqual(binding.micromamba_env, "cosmos")
            if os.name == "posix":
                self.assertEqual(stat.S_IMODE(config_file.stat().st_mode), 0o600)

    def test_configure_requires_absolute_paths(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            config = Path(root) / "runtime.json"
            with self.assertRaisesRegex(runtime.RuntimeFailure, "absolute"):
                runtime.configure_runtime(config, Path("workspace"), Path("token"), "cosmos")

    def test_configure_rejects_token_inside_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            workspace_root = Path(root) / "cosmos-workspace"
            workspace = workspace_root / "stockdata"
            workspace.mkdir(parents=True)
            token_file = workspace / "token"
            token_file.write_text("secret", encoding="utf-8")
            token_file.chmod(0o600)
            with self.assertRaisesRegex(runtime.RuntimeFailure, "outside the stockdata workspace"):
                runtime.configure_runtime(
                    Path(root) / "runtime.json", workspace_root, token_file, "cosmos"
                )

    def test_configure_rejects_replaceable_plugin_cache_root(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            workspace_root = base / ".codex" / "plugins" / "cache" / "snapshot"
            workspace_root.mkdir(parents=True)
            token_file = base / "token"
            token_file.write_text("secret", encoding="utf-8")
            token_file.chmod(0o600)

            with self.assertRaisesRegex(runtime.RuntimeFailure, "plugin, marketplace"):
                runtime.configure_runtime(
                    base / "runtime.json", workspace_root, token_file, "cosmos"
                )

    def test_configure_rejects_replaceable_plugin_directory_itself(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            workspace_root = base / ".codex" / "plugins"
            workspace_root.mkdir(parents=True)
            token_file = base / "token"
            token_file.write_text("secret", encoding="utf-8")
            token_file.chmod(0o600)

            with self.assertRaisesRegex(runtime.RuntimeFailure, "plugin, marketplace"):
                runtime.configure_runtime(
                    base / "runtime.json", workspace_root, token_file, "cosmos"
                )

    def test_configure_refuses_silent_rebinding(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            first_root = base / "workspace-a"
            second_root = base / "workspace-b"
            first_root.mkdir()
            second_root.mkdir()
            token_file = base / "token"
            token_file.write_text("secret", encoding="utf-8")
            token_file.chmod(0o600)
            config = base / "runtime.json"
            first = runtime.configure_runtime(config, first_root, token_file, "cosmos")
            marker = first.workspace / "user-data.txt"
            marker.write_text("preserve me\n", encoding="utf-8")

            with self.assertRaisesRegex(runtime.RuntimeFailure, "--reconfigure"):
                runtime.configure_runtime(config, second_root, token_file, "cosmos")

            binding = runtime.configure_runtime(
                config,
                second_root,
                token_file,
                "cosmos",
                allow_reconfigure=True,
            )
            self.assertEqual(binding.workspace, (second_root / "stockdata").resolve())
            self.assertEqual(marker.read_text(encoding="utf-8"), "preserve me\n")

    def test_configure_accepts_owner_read_only_token_file(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            workspace_root = base / "cosmos-workspace"
            workspace_root.mkdir()
            token_file = base / "token"
            token_file.write_text("secret", encoding="utf-8")
            token_file.chmod(0o400)

            binding = runtime.configure_runtime(
                base / "runtime.json", workspace_root, token_file, "cosmos"
            )
            self.assertEqual(binding.token_file, token_file.resolve())

    def test_configure_rejects_group_or_other_readable_token_file(self) -> None:
        if os.name != "posix":
            self.skipTest("POSIX permission check")
        for mode in (0o640, 0o604, 0o660):
            with self.subTest(mode=oct(mode)):
                with tempfile.TemporaryDirectory() as root:
                    base = Path(root)
                    workspace_root = base / "cosmos-workspace"
                    workspace_root.mkdir()
                    token_file = base / "token"
                    token_file.write_text("secret", encoding="utf-8")
                    token_file.chmod(mode)

                    with self.assertRaisesRegex(runtime.RuntimeFailure, "group or others"):
                        runtime.configure_runtime(
                            base / "runtime.json", workspace_root, token_file, "cosmos"
                        )

    def test_configure_rejects_config_inside_workspace_root_before_creating_workspace(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            workspace_root = base / "home-like-root"
            workspace_root.mkdir()
            token_file = base / "token"
            token_file.write_text("secret", encoding="utf-8")
            token_file.chmod(0o600)
            config = workspace_root / ".config" / "runtime.json"

            with self.assertRaisesRegex(
                runtime.RuntimeFailure, "outside the plugin and shared workspace root"
            ):
                runtime.configure_runtime(config, workspace_root, token_file, "cosmos")

            self.assertFalse((workspace_root / "stockdata").exists())

    def test_temporary_workspace_roots_are_rejected(self) -> None:
        self.assertTrue(
            REAL_IS_TEMPORARY_WORKSPACE(Path(tempfile.gettempdir()) / "cosmos-workspace")
        )
        self.assertTrue(REAL_IS_TEMPORARY_WORKSPACE(Path("/var/tmp/cosmos-workspace")))
        self.assertFalse(REAL_IS_TEMPORARY_WORKSPACE(Path.home() / "cosmos-workspace"))

        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            workspace_root = base / "cosmos-workspace"
            workspace_root.mkdir()
            token_file = base / "token"
            token_file.write_text("secret", encoding="utf-8")
            token_file.chmod(0o600)

            with patch.object(
                runtime, "is_temporary_workspace", REAL_IS_TEMPORARY_WORKSPACE
            ):
                with self.assertRaisesRegex(runtime.RuntimeFailure, "temporary"):
                    runtime.configure_runtime(
                        base / "runtime.json", workspace_root, token_file, "cosmos"
                    )

    def test_load_binding_rejects_wrong_environment(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            workspace_root = base / "cosmos-workspace"
            workspace_root.mkdir()
            token_file = base / "token"
            token_file.write_text("secret", encoding="utf-8")
            token_file.chmod(0o600)
            config = base / "runtime.json"
            runtime.configure_runtime(config, workspace_root, token_file, "cosmos")
            with patch.dict(os.environ, {"CONDA_DEFAULT_ENV": "other"}, clear=False):
                with self.assertRaisesRegex(runtime.RuntimeFailure, "cosmos"):
                    runtime.load_binding(config, verify_environment=True)

    def test_load_binding_rejects_missing_schema_without_rewriting_it(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            workspace = base / "workspace"
            workspace.mkdir()
            token_file = base / "token"
            token_file.write_text("secret", encoding="utf-8")
            token_file.chmod(0o600)
            config = base / "runtime.json"
            original = json.dumps(
                {
                    "workspace": str(workspace),
                    "token_file": str(token_file),
                    "micromamba_env": "cosmos",
                },
                indent=2,
            ) + "\n"
            config.write_text(original, encoding="utf-8")

            with self.assertRaisesRegex(runtime.RuntimeFailure, "unsupported runtime schema"):
                runtime.load_binding(config)

            self.assertEqual(config.read_text(encoding="utf-8"), original)

    def test_runtime_binding_has_one_supported_layout(self) -> None:
        self.assertEqual(
            runtime.RuntimeBinding._fields,
            ("workspace_root", "workspace", "token_file", "micromamba_env"),
        )

    def test_load_binding_rejects_unknown_schema_without_rewriting_it(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            config = Path(root) / "runtime.json"
            original = '{"schema_version": 99}\n'
            config.write_text(original, encoding="utf-8")

            with self.assertRaisesRegex(runtime.RuntimeFailure, "unsupported runtime schema"):
                runtime.load_binding(config)

            self.assertEqual(config.read_text(encoding="utf-8"), original)

    def test_load_binding_requires_integer_schema_version(self) -> None:
        for invalid_schema in (True, 1.0):
            with self.subTest(schema_version=invalid_schema):
                with tempfile.TemporaryDirectory() as root:
                    config = Path(root) / "runtime.json"
                    original = json.dumps({"schema_version": invalid_schema}) + "\n"
                    config.write_text(original, encoding="utf-8")

                    with self.assertRaisesRegex(
                        runtime.RuntimeFailure, "unsupported runtime schema"
                    ):
                        runtime.load_binding(config)

                    self.assertEqual(config.read_text(encoding="utf-8"), original)

    def test_load_binding_rejects_plugin_field_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            config = Path(root) / "runtime.json"
            original = json.dumps({"schema_version": 1, "plugin": "another-plugin"}) + "\n"
            config.write_text(original, encoding="utf-8")

            with self.assertRaisesRegex(
                runtime.RuntimeFailure, "plugin must equal cosmos-stockdata-tools"
            ):
                runtime.load_binding(config)

            self.assertEqual(config.read_text(encoding="utf-8"), original)

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

    def test_websocket_version_range(self) -> None:
        for version in ("1.8.0", "1.8.3", "1.9.1", "1.12"):
            self.assertTrue(runtime.websocket_version_supported(version), version)
        for version in ("1.7.9", "2.0.0", "2.0", "0.8.0", "unknown"):
            self.assertFalse(runtime.websocket_version_supported(version), version)

    def test_missing_websocket_error_names_install_command(self) -> None:
        with patch.object(
            runtime.importlib.metadata, "version", side_effect=Exception("not installed")
        ):
            with self.assertRaisesRegex(
                runtime.RuntimeFailure, r"uv pip install -r .*requirements\.txt"
            ):
                runtime.require_websocket()

    def test_dependency_preflight_happens_before_remote_mutation(self) -> None:
        binding = SimpleNamespace(token_file=Path("/token"))
        with (
            patch.object(runtime, "require_websocket", side_effect=runtime.RuntimeFailure("missing")),
            patch.object(runtime, "start_server") as start,
        ):
            with self.assertRaisesRegex(runtime.RuntimeFailure, "missing"):
                runtime.execute_code(binding, "1 + 1", 30)
        start.assert_not_called()

    def test_execute_connection_failure_deletes_exact_created_kernel(self) -> None:
        binding = SimpleNamespace(token_file=Path("/token"))
        with (
            patch.object(runtime, "require_websocket"),
            patch.object(runtime, "start_server"),
            patch.object(runtime, "user_path", side_effect=lambda _binding, path: path),
            patch.object(runtime, "api", return_value={"id": "kernel-1"}),
            patch.object(runtime, "connect_kernel", side_effect=runtime.RuntimeFailure("connect")),
            patch.object(runtime, "delete_kernel") as delete,
        ):
            with self.assertRaisesRegex(runtime.RuntimeFailure, "connect"):
                runtime.execute_code(binding, "1 + 1", 30)
        delete.assert_called_once_with(binding, "kernel-1")

    def test_execute_remote_error_is_nonzero_and_deletes_kernel(self) -> None:
        reply = json.dumps(
            {
                "channel": "shell",
                "parent_header": {"msg_id": "message-1"},
                "msg_type": "execute_reply",
                "content": {"status": "error", "ename": "ValueError", "evalue": "boom"},
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
            with self.assertRaisesRegex(runtime.RuntimeFailure, "ValueError: boom"):
                runtime.execute_code(binding, "raise ValueError('boom')", 30)
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

    def test_execute_timeout_deletes_kernel(self) -> None:
        websocket = TimeoutOnlyWebSocket([])
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
            with self.assertRaisesRegex(runtime.RuntimeFailure, "timed out"):
                runtime.execute_code(binding, "while True: pass", 0.05)
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

    def test_stream_stderr_message_goes_to_stderr(self) -> None:
        stdout = io.StringIO()
        stderr = io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            runtime.print_message(
                {
                    "msg_type": "stream",
                    "content": {"name": "stderr", "text": "warning line\n"},
                }
            )
        self.assertEqual(stdout.getvalue(), "")
        self.assertEqual(stderr.getvalue(), "warning line\n")

    def test_status_reports_state_without_account_details(self) -> None:
        binding = SimpleNamespace(token_file=Path("/token"))
        for server, expected in (("/user/private-account/", "running"), (None, "stopped")):
            with self.subTest(server=server):
                output = io.StringIO()
                with (
                    patch.object(
                        runtime,
                        "hub_user",
                        return_value={
                            "name": "private-account",
                            "server": server,
                            "pending": None,
                        },
                    ),
                    patch.object(runtime, "list_kernels", return_value=[]),
                    contextlib.redirect_stdout(output),
                ):
                    runtime.status(binding)
                self.assertNotIn("private-account", output.getvalue())
                self.assertIn(f"server: {expected}", output.getvalue())

    def test_start_server_tolerates_failed_dependency_during_readiness_poll(self) -> None:
        binding = SimpleNamespace(token_file=Path("/token"))
        hub_states = [
            {"name": "user-a"},
            {"name": "user-a", "server": "/user/user-a/"},
            {"name": "user-a", "server": "/user/user-a/"},
        ]
        api_effects: list[object] = [
            None,
            runtime.ApiError(424, "failed dependency"),
            None,
        ]

        def next_api_effect(*_args: object, **_kwargs: object) -> object:
            effect = api_effects.pop(0)
            if isinstance(effect, BaseException):
                raise effect
            return effect

        with (
            patch.object(runtime, "hub_user", side_effect=hub_states),
            patch.object(runtime, "user_path", side_effect=lambda _binding, path: path),
            patch.object(runtime, "api", side_effect=next_api_effect),
            patch("time.sleep"),
        ):
            runtime.start_server(binding)
        self.assertEqual(api_effects, [])

    def test_download_refuses_plugin_destination_and_existing_file(self) -> None:
        binding = SimpleNamespace(
            token_file=Path("/credentials/token"), workspace=Path("/durable/stockdata")
        )
        plugin_target = runtime.PLUGIN_DIR / "result.bin"
        with self.assertRaisesRegex(runtime.RuntimeFailure, "outside the installed plugin"):
            runtime.download_file(binding, "result.bin", plugin_target, force=False)
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            workspace = base / "stockdata"
            workspace.mkdir()
            binding = SimpleNamespace(token_file=base / "credentials" / "token", workspace=workspace)
            target = workspace / "result.bin"
            target.write_bytes(b"old")
            with self.assertRaisesRegex(runtime.RuntimeFailure, "--force"):
                runtime.download_file(binding, "result.bin", target, force=False)

    def test_download_never_overwrites_token_directory_or_runtime_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            workspace = base / "stockdata"
            workspace.mkdir()
            token_file = base / "credentials" / "token"
            binding = SimpleNamespace(token_file=token_file, workspace=workspace)
            for target in (
                token_file,
                token_file.parent / "sibling.bin",
                token_file.parent / "backup" / "token.bak",
            ):
                with self.subTest(target=target.name):
                    with self.assertRaisesRegex(runtime.RuntimeFailure, "token file"):
                        runtime.download_file(
                            binding,
                            "result.bin",
                            target,
                            force=True,
                            allow_outside_workspace=True,
                        )
            with (
                patch.object(
                    runtime,
                    "DEFAULT_CONFIG_FILE",
                    base / "config" / "runtime.json",
                ),
                self.assertRaisesRegex(runtime.RuntimeFailure, "runtime metadata"),
            ):
                runtime.download_file(
                    binding,
                    "result.bin",
                    base / "config" / "other-runtime-metadata",
                    force=True,
                    allow_outside_workspace=True,
                )

    def test_download_rejects_cosmos_config_destinations(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            workspace = base / "stockdata"
            workspace.mkdir()
            binding = SimpleNamespace(token_file=base / "credentials" / "token", workspace=workspace)
            config_root = base / "config-root"
            target = config_root / "cosmos-sources-tools" / "runtime.json"
            with (
                patch.object(runtime, "COSMOS_CONFIG_ROOT", config_root),
                self.assertRaisesRegex(runtime.RuntimeFailure, "runtime metadata"),
            ):
                runtime.download_file(
                    binding,
                    "result.bin",
                    target,
                    force=True,
                    allow_outside_workspace=True,
                )

    def test_download_confined_to_workspace_by_default(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            workspace = base / "stockdata"
            workspace.mkdir()
            binding = SimpleNamespace(token_file=base / "credentials" / "token", workspace=workspace)
            with patch.object(
                runtime, "start_server", side_effect=AssertionError("must not contact network")
            ):
                with self.assertRaisesRegex(
                    runtime.RuntimeFailure, "allow-outside-workspace"
                ):
                    runtime.download_file(
                        binding, "result.bin", base / "elsewhere" / "result.bin", force=False
                    )

    def test_download_outside_workspace_requires_explicit_flag_then_writes(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            workspace = base / "stockdata"
            workspace.mkdir()
            binding = SimpleNamespace(token_file=base / "credentials" / "token", workspace=workspace)
            target = base / "elsewhere" / "result.bin"
            with (
                patch.object(runtime, "start_server"),
                patch.object(runtime, "user_path", side_effect=lambda _binding, path: path),
                patch.object(runtime, "api", return_value=b"payload"),
            ):
                runtime.download_file(
                    binding, "result.bin", target, force=False, allow_outside_workspace=True
                )
            self.assertEqual(target.read_bytes(), b"payload")
            self.assertEqual([entry.name for entry in target.parent.iterdir()], ["result.bin"])

    def test_download_token_directory_containing_workspace_blocks_direct_entries_only(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            workspace = base / "stockdata"
            workspace.mkdir()
            token_file = base / "token"
            binding = SimpleNamespace(token_file=token_file, workspace=workspace)
            with patch.object(
                runtime, "start_server", side_effect=AssertionError("must not contact network")
            ):
                with self.assertRaisesRegex(runtime.RuntimeFailure, "token file"):
                    runtime.download_file(
                        binding,
                        "result.bin",
                        base / "direct.bin",
                        force=True,
                        allow_outside_workspace=True,
                    )
            target = base / "elsewhere" / "result.bin"
            with (
                patch.object(runtime, "start_server"),
                patch.object(runtime, "user_path", side_effect=lambda _binding, path: path),
                patch.object(runtime, "api", return_value=b"payload"),
            ):
                runtime.download_file(
                    binding, "result.bin", target, force=False, allow_outside_workspace=True
                )
            self.assertEqual(target.read_bytes(), b"payload")

    def test_download_rejects_parent_segments_in_remote_path(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            workspace = base / "stockdata"
            workspace.mkdir()
            binding = SimpleNamespace(token_file=base / "credentials" / "token", workspace=workspace)
            with patch.object(
                runtime, "start_server", side_effect=AssertionError("must not contact network")
            ):
                with self.assertRaisesRegex(runtime.RuntimeFailure, "parent-directory"):
                    runtime.download_file(
                        binding, "../outside.bin", workspace / "result.bin", force=False
                    )

    def test_download_fetches_before_writing_and_cleans_temporary_files(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            workspace = base / "stockdata"
            workspace.mkdir()
            binding = SimpleNamespace(token_file=base / "credentials" / "token", workspace=workspace)
            target = workspace / "result.bin"
            target.write_bytes(b"old")
            with (
                patch.object(runtime, "start_server"),
                patch.object(runtime, "user_path", side_effect=lambda _binding, path: path),
                patch.object(runtime, "api", side_effect=runtime.RuntimeFailure("boom")),
            ):
                with self.assertRaisesRegex(runtime.RuntimeFailure, "boom"):
                    runtime.download_file(binding, "result.bin", target, force=True)
            self.assertEqual(target.read_bytes(), b"old")
            with (
                patch.object(runtime, "start_server"),
                patch.object(runtime, "user_path", side_effect=lambda _binding, path: path),
                patch.object(runtime, "api", return_value=b"new"),
            ):
                runtime.download_file(binding, "result.bin", target, force=True)
            self.assertEqual(target.read_bytes(), b"new")
            self.assertEqual(
                [entry.name for entry in workspace.iterdir()], ["result.bin"]
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

    def test_websocket_disables_redirects_and_keeps_token_out_of_url(self) -> None:
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
        url = connect.call_args.args[0]
        self.assertNotIn("secret", url)
        self.assertNotIn("?", url)
        self.assertIn("Authorization: token secret", connect.call_args.kwargs["header"])

    def test_websocket_handshake_redirect_is_refused_and_closed(self) -> None:
        binding = SimpleNamespace(token_file=Path("/token"))
        closed: list[bool] = []
        connection = SimpleNamespace(
            handshake_response=SimpleNamespace(status=302),
            close=lambda: closed.append(True),
        )
        websocket = SimpleNamespace(create_connection=lambda *_args, **_kwargs: connection)
        with (
            patch.object(runtime, "require_websocket", return_value=websocket),
            patch.object(runtime, "token", return_value="secret"),
            patch.object(runtime, "user_path", return_value="/user/alice/api/kernels/k/channels"),
        ):
            with self.assertRaisesRegex(runtime.RuntimeFailure, "redirect or non-upgrade"):
                runtime.connect_kernel(binding, "k", 30)
        self.assertEqual(closed, [True])

    def test_main_reports_missing_config_error_on_stderr(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            stderr = io.StringIO()
            with (
                patch.object(runtime, "DEFAULT_CONFIG_FILE", Path(root) / "missing.json"),
                contextlib.redirect_stderr(stderr),
            ):
                code = runtime.main(["status"])
            self.assertEqual(code, 1)
            self.assertIn("run configure first", stderr.getvalue())

    def test_main_configure_and_show_config_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            workspace_root = base / "cosmos-workspace"
            workspace_root.mkdir()
            token_file = base / "token"
            token_file.write_text("private-token\n", encoding="utf-8")
            token_file.chmod(0o600)
            config = base / "config" / "runtime.json"

            configure_output = io.StringIO()
            with (
                patch.object(runtime, "DEFAULT_CONFIG_FILE", config),
                contextlib.redirect_stdout(configure_output),
            ):
                code = runtime.main(
                    [
                        "configure",
                        "--workspace-root",
                        str(workspace_root),
                        "--token-file",
                        str(token_file),
                        "--micromamba-env",
                        "cosmos",
                    ]
                )
            self.assertEqual(code, 0)
            self.assertIn("configured micromamba environment: cosmos", configure_output.getvalue())

            show_output = io.StringIO()
            with (
                patch.object(runtime, "DEFAULT_CONFIG_FILE", config),
                contextlib.redirect_stdout(show_output),
            ):
                self.assertEqual(runtime.main(["show-config"]), 0)
            payload = json.loads(show_output.getvalue())
            self.assertEqual(payload["micromamba_env"], "cosmos")
            self.assertEqual(payload["workspace"], str((workspace_root / "stockdata").resolve()))
            self.assertNotIn("private-token", show_output.getvalue())

    def test_main_exec_file_rejects_scripts_outside_workspace(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            workspace_root = base / "cosmos-workspace"
            workspace_root.mkdir()
            token_file = base / "token"
            token_file.write_text("secret", encoding="utf-8")
            token_file.chmod(0o600)
            config = base / "config" / "runtime.json"
            runtime.configure_runtime(config, workspace_root, token_file, "cosmos")
            outside_script = base / "script.py"
            outside_script.write_text("print('hello')\n", encoding="utf-8")

            stderr = io.StringIO()
            with (
                patch.object(runtime, "DEFAULT_CONFIG_FILE", config),
                patch.dict(os.environ, {"CONDA_DEFAULT_ENV": "cosmos"}, clear=False),
                patch.object(
                    runtime, "execute_code", side_effect=AssertionError("must not execute")
                ),
                contextlib.redirect_stderr(stderr),
            ):
                code = runtime.main(["exec-file", str(outside_script)])
            self.assertEqual(code, 1)
            self.assertIn("inside the configured stockdata workspace", stderr.getvalue())


if __name__ == "__main__":
    unittest.main()
