"""Plugin manifests for Claude Code and Codex, the shared skill, and one version everywhere."""
import importlib.util
import json
import shutil
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

def _tool(name):
    spec = importlib.util.spec_from_file_location(name, REPO / "tools" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


bump = _tool("bump_version")
build_plugin = _tool("build_plugin")


def _json(rel):
    return json.loads((REPO / rel).read_text(encoding="utf-8"))


def _frontmatter(rel):
    text = (REPO / rel).read_text(encoding="utf-8")
    assert text.startswith("---\n"), rel
    head = text[4:text.index("\n---", 4)]
    return dict(line.split(": ", 1) for line in head.splitlines() if ": " in line)


def test_all_manifests_name_the_same_plugin():
    assert _json(".claude-plugin/plugin.json")["name"] == "htmldeck"
    assert _json(".codex-plugin/plugin.json")["name"] == "htmldeck"
    assert _json("packaging/npm/package.json")["name"] == "@avis309/htmldeck"
    claude_mp = _json(".claude-plugin/marketplace.json")
    # The released plugin tree (tools/build_plugin.py), not this root: its lockfile would make an
    # install run npm ci with the dev tooling.
    plugin_branch = {"source": "github", "repo": "avis309/html-deck", "ref": "plugin"}
    assert claude_mp["plugins"] == [{**claude_mp["plugins"][0], "name": "htmldeck", "source": plugin_branch}]
    codex_mp = _json(".agents/plugins/marketplace.json")
    assert codex_mp["plugins"][0]["name"] == "htmldeck"
    assert codex_mp["plugins"][0]["source"] == {"source": "local", "path": "./"}


def test_manifests_carry_author_and_license():
    for rel in (".claude-plugin/plugin.json", ".codex-plugin/plugin.json"):
        data = _json(rel)
        assert data["license"] == "MIT"
        assert data["author"]["email"] == "hunganh.freeze@gmail.com"


def test_codex_manifest_points_at_the_skills():
    data = _json(".codex-plugin/plugin.json")
    assert (REPO / data["skills"] / "open" / "SKILL.md").is_file()
    assert data["interface"]["displayName"] == "HTML Deck"


def test_skill_has_frontmatter_and_no_command_shadows_it():
    skill = _frontmatter("skills/open/SKILL.md")
    assert skill["name"] == "open" and len(skill["description"]) > 80 and skill["argument-hint"]
    # A command of the same name would list /htmldeck:open twice in Claude Code.
    assert not (REPO / "commands" / "open.md").exists()


def test_skill_names_files_that_exist():
    text = (REPO / "skills/open/SKILL.md").read_text(encoding="utf-8")
    for rel in ("scripts/htmldeck-run", "scripts/htmldeck-run.cmd"):
        assert rel in text and (REPO / rel).is_file()
    assert "HTMLDECK_URL=" in text


def test_versions_agree_everywhere():
    versions = bump.manifest_versions(REPO)
    assert set(versions) == {"pyproject.toml", *bump.JSON_MANIFESTS}
    assert len(set(versions.values())) == 1, versions


def test_bump_writes_every_manifest(tmp_path):
    for rel in ("pyproject.toml", *bump.JSON_MANIFESTS):
        (tmp_path / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(REPO / rel, tmp_path / rel)
    bump.write_version("9.8.7", tmp_path)
    assert set(bump.manifest_versions(tmp_path).values()) == {"9.8.7"}
    # Only the version line changes: inline arrays and line endings stay as written.
    for rel in ("pyproject.toml", *bump.JSON_MANIFESTS):
        before = (REPO / rel).read_bytes().splitlines()
        after = (tmp_path / rel).read_bytes().splitlines()
        assert len(before) == len(after), rel
        assert sum(a != b for a, b in zip(before, after, strict=True)) == 1, rel


def test_bump_check_reports_mismatch(capsys):
    current = bump.manifest_versions(REPO)["pyproject.toml"]
    assert bump.main(["--check", current]) == 0
    assert bump.main(["--check", "99.0.0"]) == 1
    assert "expected 99.0.0" in capsys.readouterr().err
    assert bump.main(["not-a-version"]) == 2


def test_plugin_icon_is_a_square_png_the_directory_accepts():
    data = _json(".claude-plugin/plugin.json")
    icon = REPO / data["icon"]
    head = icon.read_bytes()[:24]
    # PNG signature, then the IHDR width and height (big-endian).
    width, height = int.from_bytes(head[16:20], "big"), int.from_bytes(head[20:24], "big")
    assert head[:8] == b"\x89PNG\r\n\x1a\n" and width == height and 512 <= width <= 2048
    assert icon.stat().st_size < 2 * 1024 * 1024


def test_plugin_tree_holds_what_the_plugin_runs_and_no_dev_tooling(tmp_path):
    out = tmp_path / "plugin"
    files = build_plugin.build(out)
    names = {p.name for p in out.rglob("*")}
    # No npm install on plugin install, no specs screened as plugin code.
    assert not names & {"package.json", "package-lock.json", "node_modules", "tests", "eslint.config.mjs"}
    assert not any(f.startswith(("tests/", "tools/", ".github/workflows/", "packaging/", "samples/")) for f in files)
    for rel in (".claude-plugin/plugin.json", ".claude-plugin/icon.png", ".codex-plugin/plugin.json", "skills/open/SKILL.md",
                "scripts/htmldeck-run", "scripts/htmldeck-run.cmd", "scripts/launcher.py", "htmldeck/server.py",
                "htmldeck/web/index.html", "LICENSE", "PRIVACY.md", ".gitattributes"):
        assert (out / rel).is_file(), rel
    # The directory's limits: at most 512 files, each code/text file under 256 KiB.
    assert len(files) <= 512
    big = [f for f in files if not f.endswith((".png", ".jpg", ".woff2")) and (out / f).stat().st_size > 256 * 1024]
    assert not big, big
    # Everything the skill and the manifests name is in the tree.
    assert (out / _json(".codex-plugin/plugin.json")["skills"] / "open" / "SKILL.md").is_file()
    assert (out / _json(".claude-plugin/plugin.json")["icon"]).is_file()
