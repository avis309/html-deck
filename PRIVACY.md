# Privacy policy — HTML Deck

HTML Deck runs entirely on your computer. It has no account, no server of its own, no analytics
and no telemetry. Nothing you edit is sent to the author or to any service.

## What it reads and writes

- **Your HTML documents**, inside the workspace folder you start it in (or the file you pass
  with `--file`). Saving writes the file in place and keeps a backup in `.htmldeck_bak/` beside it.
- **Review notes** you pin in the editor, in `.htmldeck_notes/<name>.json` beside the document,
  so the agent (Claude Code or Codex) can read and resolve them.
- **Which workspaces you trusted** to run their own scripts, in `trusted-workspaces.json` in
  your config folder (`%APPDATA%\htmldeck` on Windows, `~/.config/htmldeck` elsewhere, or
  `HTMLDECK_CONFIG_DIR`).
- **Editor state** in your browser's storage for the editor's page: the language, the last file
  opened, which files you let load remote scripts, the run's session key (local storage), and
  unsaved drafts (IndexedDB).

It does not collect personal data, and none of the above leaves your machine through HTML Deck.

## Network

- The editor server listens on `127.0.0.1` only. Each run makes a random session key, printed in
  the link it opens; without it the editor's API refuses every call.
- A document you open or present may load its own resources (images, fonts, scripts from a CDN)
  as it would in any browser; in the edit view remote scripts stay off until you trust the file.
- **Save ▾ → one HTML file**, only when you choose to embed files from the web, downloads the
  images, styles and fonts the document links to so they can be built into the copy. It sends
  nothing but those requests, and refuses local and private network addresses.

## Contact

Questions: hunganh.freeze@gmail.com · https://github.com/avis309/html-deck/issues
