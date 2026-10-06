"""The plugin launcher runs the plugin's own copy of HtmlDeck with whatever Python ≥ 3.11 is on PATH."""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
posix_only = pytest.mark.skipif(os.name == "nt", reason="sh launcher")
windows_only = pytest.mark.skipif(os.name != "nt", reason="cmd launcher")


@pytest.fixture
def plugin(tmp_path):
    """A copy of the plugin (scripts + package) somewhere else, like Claude/Codex's plugin cache."""
    root = tmp_path / "plugin"
    shutil.copytree(REPO / "scripts", root / "scripts")
    shutil.copytree(REPO / "htmldeck", root / "htmldeck", ignore=shutil.ignore_patterns("__pycache__"))
    return root


@pytest.fixture
def workspace(tmp_path):
    ws = tmp_path / "ws"
    ws.mkdir()
    return ws


def _expected_editor(plugin):
    return str((plugin / "htmldeck" / "web" / "index.html").resolve())


def test_launcher_runs_its_own_copy(plugin, workspace):
    # The dev venv has htmldeck installed from REPO; the launcher must still use the copy beside it.
    res = subprocess.run([sys.executable, str(plugin / "scripts" / "launcher.py"), "--dry", "--root", str(workspace)],
                         capture_output=True, text=True, encoding="utf-8", check=False)
    assert res.returncode == 0, res.stderr
    assert f"editor={_expected_editor(plugin)}" in res.stdout


def test_launcher_notes_subcommand(plugin, workspace):
    (workspace / "a.html").write_text("<p>x</p>", encoding="utf-8")
    res = subprocess.run([sys.executable, str(plugin / "scripts" / "launcher.py"), "notes", "--root", str(workspace), "--file", "a.html"],
                         capture_output=True, text=True, encoding="utf-8", check=False)
    assert res.returncode == 0, res.stderr
    assert "a.html" in res.stdout


def _shim_dir(tmp_path, name, body):
    bindir = tmp_path / "bin"
    bindir.mkdir(exist_ok=True)
    shim = bindir / name
    shim.write_text(body, encoding="utf-8")
    shim.chmod(0o755)
    return bindir


@posix_only
def test_sh_launcher_finds_python_on_path(plugin, workspace, tmp_path):
    bindir = _shim_dir(tmp_path, "python3", f'#!/bin/sh\nexec "{sys.executable}" "$@"\n')
    res = subprocess.run(["/bin/sh", str(plugin / "scripts" / "htmldeck-run"), "--dry", "--root", str(workspace)],
                         capture_output=True, text=True, env={"PATH": str(bindir)}, check=False)
    assert res.returncode == 0, res.stderr
    assert f"editor={_expected_editor(plugin)}" in res.stdout


@posix_only
def test_sh_launcher_without_python_explains_and_exits_127(plugin, tmp_path):
    empty = tmp_path / "empty"
    empty.mkdir()
    res = subprocess.run(["/bin/sh", str(plugin / "scripts" / "htmldeck-run"), "--dry"],
                         capture_output=True, text=True, env={"PATH": str(empty)}, check=False)
    assert res.returncode == 127
    assert "Python" in res.stderr and "3.11" in res.stderr


@posix_only
def test_sh_launcher_is_executable_in_git():
    mode = subprocess.run(["git", "ls-files", "-s", "scripts/htmldeck-run"], cwd=REPO, capture_output=True, text=True,
                          check=False).stdout
    assert mode.startswith("100755")


@windows_only
def test_cmd_launcher_finds_python_on_path(plugin, workspace, tmp_path):
    bindir = _shim_dir(tmp_path, "python.bat", f'@"{sys.executable}" %*\r\n')
    env = {"PATH": f"{bindir};{os.environ['SystemRoot']}\\System32", "SystemRoot": os.environ["SystemRoot"]}
    res = subprocess.run(["cmd", "/c", str(plugin / "scripts" / "htmldeck-run.cmd"), "--dry", "--root", str(workspace)],
                         capture_output=True, text=True, encoding="utf-8", env=env, check=False)
    assert res.returncode == 0, res.stderr
    assert f"editor={_expected_editor(plugin)}" in res.stdout


def _copied_command(plugin, workspace, name, shell="posix"):
    """The command the editor shows, as the plugin's copy of the server builds it."""
    code = ("import sys; from pathlib import Path; sys.path.insert(0, sys.argv[1]); from htmldeck.server import notes_command;"
            "print(notes_command(Path(sys.argv[2]) / sys.argv[3], Path(sys.argv[2]), sys.argv[4]))")
    res = subprocess.run([sys.executable, "-X", "utf8", "-c", code, str(plugin), str(workspace), name, shell],
                         capture_output=True, text=True, encoding="utf-8", check=True)
    return res.stdout.strip()


def _seed_note(workspace, name):
    (workspace / name).write_text("<h1>10 月改版</h1>", encoding="utf-8")
    side = workspace / ".htmldeck_notes"
    side.mkdir()
    note = {"id": "n1", "note": "標題字級加大", "status": "open", "selector": "h1", "tag": "h1", "text": "10 月改版", "line": 1}
    (side / f"{name}.json").write_text(json.dumps({"file": name, "notes": [note]}, ensure_ascii=False), encoding="utf-8")
    return side / f"{name}.json"


NOTE_DOC = "10月改版 台灣's Bob’s 提案.html"   # PowerShell reads ’ as a quote too


def _run_copied(shell, cmd, cwd):
    # No htmldeck-notes on PATH, run from another folder: the command alone must be enough.
    env = {k: v for k, v in os.environ.items() if k not in ("PYTHONPATH", "VIRTUAL_ENV")}
    env["PYTHONIOENCODING"] = "utf-8"
    return subprocess.run([*shell, cmd], capture_output=True, text=True, encoding="utf-8", cwd=cwd, env=env, check=False)


@posix_only
def test_copied_notes_command_runs_in_sh_from_anywhere(plugin, workspace, tmp_path):
    side = _seed_note(workspace, NOTE_DOC)
    cmd = _copied_command(plugin, workspace, NOTE_DOC)
    res = _run_copied(["sh", "-c"], cmd, tmp_path)
    assert res.returncode == 0 and "標題字級加大" in res.stdout, res.stderr
    res = _run_copied(["sh", "-c"], cmd + " --done n1", tmp_path)
    assert res.returncode == 0, res.stderr
    assert json.loads(side.read_text(encoding="utf-8"))["notes"][0]["status"] == "done"


@windows_only
def test_copied_notes_command_runs_in_powershell_from_anywhere(plugin, workspace, tmp_path):
    side = _seed_note(workspace, NOTE_DOC)
    cmd = _copied_command(plugin, workspace, NOTE_DOC, "powershell")
    shell = ["powershell", "-NoProfile", "-NonInteractive", "-Command"]
    res = _run_copied(shell, "[Console]::OutputEncoding = [Text.Encoding]::UTF8; " + cmd, tmp_path)
    assert res.returncode == 0 and "標題字級加大" in res.stdout, (cmd, res.stdout, res.stderr)
    res = _run_copied(shell, cmd + " --done n1", tmp_path)
    assert res.returncode == 0, (cmd, res.stdout, res.stderr)
    assert json.loads(side.read_text(encoding="utf-8"))["notes"][0]["status"] == "done"


@windows_only
def test_copied_notes_command_runs_in_git_bash(plugin, workspace, tmp_path):
    bash = Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Git" / "bin" / "bash.exe"
    if not bash.is_file():
        pytest.skip("Git Bash not installed")
    side = _seed_note(workspace, NOTE_DOC)
    cmd = _copied_command(plugin, workspace, NOTE_DOC, "posix")
    res = _run_copied([str(bash), "-c"], cmd + " --done n1", tmp_path)
    assert res.returncode == 0, (cmd, res.stdout, res.stderr)
    assert json.loads(side.read_text(encoding="utf-8"))["notes"][0]["status"] == "done"
