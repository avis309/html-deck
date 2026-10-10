"""Build the plugin tree: only what the Claude Code / Codex plugin runs, none of the dev tooling.

  python tools/build_plugin.py --out DIR

The release workflow publishes DIR to the `plugin` branch, which the marketplace and the plugin
directory point at. The repository root is not a plugin root on its own: its package.json and
package-lock.json (eslint, Playwright, reveal.js for the specs) would make Claude Code run
`npm ci` on every install, and its tests would be screened as plugin code.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
# Tracked files under these paths make the plugin; everything else stays on main.
KEEP = ("htmldeck/", "scripts/", "skills/", ".claude-plugin/plugin.json", ".claude-plugin/icon.png",
        ".codex-plugin/", "LICENSE", "PRIVACY.md", "README.md", "readme/", ".github/assets/",
        ".gitattributes")   # keeps scripts/htmldeck-run LF on a Windows checkout (sh refuses CRLF)
# Never in a plugin tree: an install would run npm, or they are dev-only.
FORBIDDEN = ("package.json", "package-lock.json", "npm-shrinkwrap.json", "bun.lock", "node_modules", "tests")


def version_key(version: str) -> tuple:
    """SemVer precedence: 1.2.3-rc.1 < 1.2.3-rc.2 < 1.2.3 (build metadata ignored)."""
    core, _, pre = version.split("+")[0].partition("-")
    ids = tuple((0, int(p), "") if p.isdigit() else (1, 0, p) for p in pre.split(".")) if pre else ()
    return tuple(int(x) for x in core.split(".")), not pre, ids


def plugin_files(root: Path = ROOT) -> list[str]:
    # Tracked files, and new ones not ignored yet (the same set once committed, as in CI).
    tracked = subprocess.run(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], cwd=root, check=True,
                             capture_output=True).stdout.decode().split("\0")
    return sorted({f for f in tracked if f and f.startswith(KEEP) and "__pycache__" not in f and (root / f).is_file()})


def build(out: Path, root: Path = ROOT) -> list[str]:
    files = plugin_files(root)
    if out.exists():
        shutil.rmtree(out)
    for rel in files:
        dest = out / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(root / rel, dest)
    bad = [p for p in out.rglob("*") if p.name in FORBIDDEN]
    if bad:
        raise SystemExit(f"not allowed in the plugin tree: {', '.join(str(p.relative_to(out)) for p in bad)}")
    for need in (".gitattributes", ".claude-plugin/plugin.json", ".claude-plugin/icon.png", "skills/open/SKILL.md", "scripts/launcher.py", "htmldeck/server.py"):
        if not (out / need).is_file():
            raise SystemExit(f"missing from the plugin tree: {need}")
    return files


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", required=True, help="Folder to write the plugin tree to (replaced)")
    args = parser.parse_args(argv)
    files = build(Path(args.out).resolve())
    print(f"{len(files)} files → {args.out}")


if __name__ == "__main__":
    main(sys.argv[1:])
