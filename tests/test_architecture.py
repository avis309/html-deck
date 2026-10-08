"""The editor's module architecture check (tools/check-architecture.mjs): layers, cycles, ratchet."""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
TOOL = REPO / "tools" / "check-architecture.mjs"
NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(NODE is None or not (REPO / "node_modules" / "espree").is_dir(),
                                reason="node and npm install needed")


def run(root: Path, baseline: Path, *extra: str):
    p = subprocess.run([NODE, str(TOOL), "--root", str(root), "--baseline", str(baseline), *extra],
                       capture_output=True, text=True, cwd=REPO)
    return p.returncode, p.stdout + p.stderr


def tree(tmp_path: Path, files: dict[str, str], baseline: dict | None = None) -> tuple[Path, Path]:
    root = tmp_path / "js"
    for rel, src in files.items():
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_text(src, encoding="utf-8")
    b = tmp_path / "baseline.json"
    b.write_text(json.dumps(baseline or {"upward": [], "cycles": []}), encoding="utf-8")
    return root, b


def test_the_editor_passes_against_its_baseline():
    code, out = run(REPO / "htmldeck/web/js", REPO / "tools/architecture-baseline.json")
    assert code == 0, out


def test_an_import_up_the_layers_fails(tmp_path):
    root, b = tree(tmp_path, {"editor/a.mjs": "import { x } from '../ui/b.mjs';\nx();\n", "ui/b.mjs": "export const x = 1;\n"})
    code, out = run(root, b)
    assert code == 1 and "editor/a.mjs -> ui/b.mjs" in out


def test_a_cycle_fails_even_inside_one_layer(tmp_path):
    root, b = tree(tmp_path, {"editor/a.mjs": "import { b } from './b.mjs';\nexport const a = () => b;\n",
                              "editor/b.mjs": "import { a } from './a.mjs';\nexport const b = () => a;\n"})
    code, out = run(root, b)
    assert code == 1 and "cycle" in out and "editor/a.mjs" in out


def test_a_path_with_the_wrong_case_fails(tmp_path):
    # macOS and Windows would load it; Linux (and a case-sensitive server) would not.
    root, b = tree(tmp_path, {"editor/a.mjs": "import { b } from './B.mjs';\nb();\n", "editor/b.mjs": "export const b = 1;\n"})
    code, out = run(root, b)
    assert code == 1 and "B.mjs" in out


def test_dynamic_and_re_exports_count(tmp_path):
    root, b = tree(tmp_path, {"core/a.mjs": "export * from '../ui/b.mjs';\n", "editor/c.mjs": "import('../ui/b.mjs');\n",
                              "ui/b.mjs": "export const x = 1;\n"})
    code, out = run(root, b)
    assert code == 1 and "core/a.mjs -> ui/b.mjs" in out and "editor/c.mjs -> ui/b.mjs" in out


def test_the_baseline_only_shrinks(tmp_path):
    # An allowance that is no longer needed must be removed, so fixed edges cannot come back.
    root, b = tree(tmp_path, {"editor/a.mjs": "export const a = 1;\n"},
                   {"upward": ["editor/a.mjs -> ui/b.mjs"], "cycles": []})
    code, out = run(root, b)
    assert code == 1 and "no longer" in out


def test_baselined_violations_pass(tmp_path):
    files = {"editor/a.mjs": "import { x } from '../ui/b.mjs';\nx();\n", "ui/b.mjs": "export const x = 1;\n"}
    root, b = tree(tmp_path, files, {"upward": ["editor/a.mjs -> ui/b.mjs"], "cycles": []})
    assert run(root, b)[0] == 0


def test_importing_a_name_the_module_does_not_export_fails(tmp_path):
    # The browser refuses the whole module graph (SyntaxError) and the editor stays blank;
    # ESLint does not see it.
    root, b = tree(tmp_path, {"editor/a.mjs": "import { gone, here } from './b.mjs';\nhere(gone);\n",
                              "editor/b.mjs": "export function here() {}\nexport const x = 1, y = 2;\nexport { x as z };\n"})
    code, out = run(root, b)
    assert code == 1 and "'gone'" in out and "'here'" not in out


def test_every_kind_of_export_is_seen(tmp_path):
    root, b = tree(tmp_path, {"editor/a.mjs": "import { f, g, x, y, z } from './b.mjs';\nf(g, x, y, z);\n",
                              "editor/b.mjs": "export function f() {}\nexport async function g() {}\nexport const x = 1, y = 2;\nexport { x as z };\n"})
    assert run(root, b)[0] == 0


@pytest.mark.parametrize("importer, exporter, ok", [
    ("import { default as x } from './b.mjs';\nx;\n", "export default 1;\n", True),
    ("import { x } from './b.mjs';\nx;\n", "export const { x } = { x: 1 };\n", True),
    ("import x from './b.mjs';\nx;\n", "export const y = 1;\n", False),
    ("import x from './b.mjs';\nx;\n", "export default 1;\n", True),
    ("import { missing } from './b.mjs';\nmissing;\n", "export * as ns from './c.mjs';\n", False),
    ("import { ns } from './b.mjs';\nns;\n", "export * as ns from './c.mjs';\n", True),
])
def test_export_forms(tmp_path, importer, exporter, ok):
    root, b = tree(tmp_path, {"editor/a.mjs": importer, "editor/b.mjs": exporter, "editor/c.mjs": "export const y = 1;\n"})
    assert (run(root, b)[0] == 0) is ok


def test_a_named_re_export_of_a_missing_name_fails(tmp_path):
    root, b = tree(tmp_path, {"editor/a.mjs": "import { x } from './b.mjs';\nx;\n",
                              "editor/b.mjs": "export { missing as x } from './c.mjs';\n", "editor/c.mjs": "export const y = 1;\n"})
    code, out = run(root, b)
    assert code == 1 and "'missing'" in out


def test_using_a_project_name_without_importing_it_fails(tmp_path):
    # `History` is also a browser global, so ESLint's no-undef is silent and the call reaches
    # window.History at runtime.
    root, b = tree(tmp_path, {"core/history.mjs": "export function recordOp() {}\n",
                              "editor/a.mjs": "import * as History from '../core/history.mjs';\nHistory.recordOp();\n",
                              "editor/b.mjs": "export const f = () => History.recordOp();\n"})
    code, out = run(root, b)
    assert code == 1 and "editor/b.mjs" in out and "History" in out and "editor/a.mjs" not in out


def test_a_module_with_export_star_still_counts_its_own_names(tmp_path):
    root, b = tree(tmp_path, {"core/c.mjs": "export const y = 1;\n",
                              "core/history.mjs": "export class History { static recordOp() {} }\nexport * from './c.mjs';\n",
                              "editor/b.mjs": "export const f = () => History.recordOp();\n"})
    code, out = run(root, b)
    assert code == 1 and "'History'" in out


def test_a_module_outside_every_layer_fails(tmp_path):
    root, b = tree(tmp_path, {"misc/a.mjs": "export const a = 1;\n"})
    code, out = run(root, b)
    assert code == 1 and "misc/a.mjs" in out and "layer" in out


def test_hooks_used_must_be_installed_and_installed_hooks_used(tmp_path):
    root, b = tree(tmp_path, {"shared/hooks.mjs": "export const hooks = {};\nexport function installHooks() {}\n",
                              "editor/a.mjs": "import { hooks } from '../shared/hooks.mjs';\nexport const f = () => hooks.paint();\n",
                              "ui/p.mjs": "export function paint() {}\nexport function extra() {}\n",
                              "app.mjs": "import { installHooks } from './shared/hooks.mjs';\nimport { extra } from './ui/p.mjs';\ninstallHooks({\n  extra,\n});\n"})
    code, out = run(root, b)
    assert code == 1 and "'paint'" in out and "'extra'" in out
