"""Server-side guarantees of the HTML editor: path confinement, safe saves, request guards."""
import http.client
import json
import os
import socket
import threading
import time

import pytest

from htmldeck import server as ed


@pytest.fixture
def root(tmp_path):
    (tmp_path / "output" / "deck").mkdir(parents=True)
    (tmp_path / "output" / "deck" / "a.html").write_text("<p>a</p>", encoding="utf-8")
    (tmp_path / "output" / "tmp").mkdir()
    (tmp_path / "output" / "tmp" / "skip.html").write_text("x", encoding="utf-8")
    (tmp_path / "output" / ".hidden").mkdir()
    (tmp_path / "output" / ".hidden" / "secret.html").write_text("x", encoding="utf-8")
    (tmp_path / ".env").write_text("TOKEN=1", encoding="utf-8")
    return tmp_path.resolve()


def test_resolve_accepts_workspace_html(root):
    assert ed.resolve_html_path("output/deck/a.html", root) == root / "output/deck/a.html"


@pytest.mark.parametrize("req, status", [
    ("../outside.html", 403),
    ("/etc/passwd.html", 403),
    ("output/.hidden/secret.html", 403),
    ("output/deck/a.txt", 400),
    ("", 400),
    (None, 400),
])
def test_resolve_rejects_unsafe_paths(root, req, status):
    with pytest.raises(ed.EditorError) as exc:
        ed.resolve_html_path(req, root)
    assert exc.value.status == status


def test_resolve_allows_explicit_cli_target_outside_root(root, tmp_path_factory):
    outside = tmp_path_factory.mktemp("elsewhere") / "x.html"
    outside.write_text("x", encoding="utf-8")
    assert ed.resolve_html_path(str(outside), root, frozenset({outside.resolve()})) == outside.resolve()


def test_list_skips_tmp_hidden_and_previews(root):
    (root / "output" / "deck" / f"{ed.PREVIEW_PREFIX}abc.html").write_text("x", encoding="utf-8")
    assert [f["path"] for f in ed.list_html_files(root)] == ["output/deck/a.html"]


def test_list_covers_the_whole_workspace(root):
    # Any layout: documents at the root or in any folder, not just output/ and docs/.
    (root / "deck.html").write_text("x", encoding="utf-8")
    (root / "slides" / "q3").mkdir(parents=True)
    (root / "slides" / "q3" / "talk.htm").write_text("x", encoding="utf-8")
    (root / "node_modules" / "pkg").mkdir(parents=True)
    (root / "node_modules" / "pkg" / "readme.html").write_text("x", encoding="utf-8")
    assert [f["path"] for f in ed.list_html_files(root)] == ["deck.html", "output/deck/a.html", "slides/q3/talk.htm"]


def test_main_uses_the_folder_of_a_file_outside_the_workspace(tmp_path, monkeypatch, capsys):
    doc = tmp_path / "talks" / "q3.html"
    doc.parent.mkdir()
    doc.write_text("<p>x</p>", encoding="utf-8")
    other = tmp_path / "ws"
    other.mkdir()
    monkeypatch.chdir(other)
    ed.main(["--file", str(doc), "--dry"])
    assert f"root={doc.parent}" in capsys.readouterr().out
    with pytest.raises(SystemExit):
        ed.main(["--root", str(other), "--file", str(doc), "--dry"])


def test_save_writes_backup_and_new_mtime(root):
    target = root / "output/deck/a.html"
    mtime = ed.load_html(target, root)["mtime_ns"]
    res = ed.save_html(target, "<p>b</p>", mtime, False, root)
    assert target.read_text(encoding="utf-8") == "<p>b</p>"
    backups = list((target.parent / ed.BACKUP_DIR_NAME).glob("a.html.*.bak"))
    assert len(backups) == 1 and backups[0].read_text(encoding="utf-8") == "<p>a</p>"
    assert res["mtime_ns"] == str(target.stat().st_mtime_ns)
    assert not list(target.parent.glob(".a.html.tmp.*"))


def test_save_keeps_a_utf8_bom(root):
    target = root / "output/deck/a.html"
    target.write_bytes(b"\xef\xbb\xbf<p>a</p>")
    data = ed.load_html(target, root)
    assert data["content"] == "<p>a</p>"
    res = ed.save_html(target, "<p>b</p>", data["mtime_ns"], False, root)
    assert target.read_bytes() == b"\xef\xbb\xbf<p>b</p>" and res["bytes_written"] == 11
    # No BOM before: none after.
    target.write_bytes(b"<p>a</p>")
    ed.save_html(target, "<p>c</p>", None, False, root)
    assert target.read_bytes() == b"<p>c</p>"


def test_save_refuses_when_file_changed_since_load(root):
    target = root / "output/deck/a.html"
    stale = ed.load_html(target, root)["mtime_ns"]
    target.write_text("<p>changed elsewhere</p>", encoding="utf-8")
    os.utime(target, ns=(int(stale) + 5_000_000_000, int(stale) + 5_000_000_000))
    with pytest.raises(ed.EditorError) as exc:
        ed.save_html(target, "<p>mine</p>", stale, False, root)
    assert exc.value.status == 409
    assert target.read_text(encoding="utf-8") == "<p>changed elsewhere</p>"
    ed.save_html(target, "<p>mine</p>", stale, True, root)
    assert target.read_text(encoding="utf-8") == "<p>mine</p>"


def test_save_rotates_backups(root):
    target = root / "output/deck/a.html"
    for i in range(ed.BACKUPS_KEPT + 3):
        ed.save_html(target, f"<p>{i}</p>", None, False, root)
    assert len(list((target.parent / ed.BACKUP_DIR_NAME).glob("a.html.*.bak"))) == ed.BACKUPS_KEPT


@pytest.mark.parametrize("content, status", [("", 400), ("   ", 400), (None, 400)])
def test_save_rejects_empty_content(root, content, status):
    with pytest.raises(ed.EditorError) as exc:
        ed.save_html(root / "output/deck/a.html", content, None, False, root)
    assert exc.value.status == status


def test_save_never_creates_new_files(root):
    with pytest.raises(ed.EditorError) as exc:
        ed.save_html(root / "output/deck/new.html", "<p>x</p>", None, False, root)
    assert exc.value.status == 404


def test_preview_url_sits_next_to_source(root):
    url = ed.preview_url(root / "output/deck/a.html", root)
    assert url.startswith(f"/output/deck/{ed.PREVIEW_PREFIX}") and url.endswith(".html")
    assert ed.preview_url(None, root).count("/") == 1


@pytest.fixture(autouse=True)
def config_dir(tmp_path_factory, monkeypatch):
    """Workspace trust is remembered in the user's config folder: a fresh one per test."""
    d = tmp_path_factory.mktemp("config")
    monkeypatch.setenv("HTMLDECK_CONFIG_DIR", str(d))
    return d


def _serve(root, **attrs):
    handler = type("H", (ed.HTMLEditorHandler,), {"root": root, "target_file": root / "output/deck/a.html", **attrs})
    handler.previews = ed.OrderedDict()
    httpd = ed.http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


@pytest.fixture
def untrusted_server(root):
    httpd = _serve(root)
    yield httpd.server_address[1]
    httpd.shutdown()
    httpd.server_close()


@pytest.fixture
def server(root):
    # Most tests are about a workspace whose scripts the user trusted (as --trust does).
    handler = type("H", (ed.HTMLEditorHandler,), {"root": root, "target_file": root / "output/deck/a.html", "trusted_session": True})
    handler.previews = ed.OrderedDict()
    httpd = ed.http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield httpd.server_address[1]
    httpd.shutdown()
    httpd.server_close()


def _local(port):
    """What the editor sends: a local Host and this run's session key."""
    return {"Host": f"127.0.0.1:{port}", ed.SESSION_HEADER: ed.HTMLEditorHandler.session_key}


def _watch(path):
    """The watch stream takes the key in its query (EventSource cannot send headers)."""
    return f"{path}&key={ed.HTMLEditorHandler.session_key}"


def _request(port, method, path, body=None, headers=None):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    # What the browser sends for the editor's own fetches (page scripts cannot set it).
    hdrs = {**_local(port), "Sec-Fetch-Site": "same-origin"}
    hdrs.update(headers or {})
    conn.request(method, path, body=body, headers=hdrs)
    res = conn.getresponse()
    data = res.read()
    conn.close()
    return res.status, data


def _symlink_or_skip(link, target):
    try:
        link.symlink_to(target, target_is_directory=True)
    except OSError as exc:   # Windows without the symlink privilege
        pytest.skip(f"symlinks not permitted: {exc}")


def test_http_config_reports_whether_file_was_explicit(server):
    status, data = _request(server, "GET", "/api/config")
    assert status == 200
    # test_hooks is off unless the server is started with --test-hooks (spec only).
    assert json.loads(data) == {"default_path": "output/deck/a.html", "explicit": False, "test_hooks": False, "preview_origin": "", "trusted": True}


def test_http_root_redirect_keeps_query(server):
    conn = http.client.HTTPConnection("127.0.0.1", server, timeout=5)
    conn.request("GET", "/?file=output/deck/a.html", headers={**_local(server)})
    res = conn.getresponse()
    res.read()
    conn.close()
    assert res.status == 302 and res.getheader("Location").endswith("?file=output/deck/a.html")


def test_http_rejects_foreign_host(server):
    status, _ = _request(server, "GET", "/api/load?path=output/deck/a.html", headers={"Host": "evil.example"})
    assert status == 403


def test_http_blocks_dotfiles(server):
    assert _request(server, "GET", "/.env")[0] == 404


def test_http_save_requires_json_and_same_origin(server):
    body = json.dumps({"path": "output/deck/a.html", "content": "<p>pwn</p>"})
    assert _request(server, "POST", "/api/save", body, {"Content-Type": "text/plain"})[0] == 415
    cross = {"Content-Type": "application/json", "Origin": "https://evil.example"}
    assert _request(server, "POST", "/api/save", body, cross)[0] == 403
    ok = {"Content-Type": "application/json", "Origin": f"http://127.0.0.1:{server}"}
    status, data = _request(server, "POST", "/api/save", body, ok)
    assert status == 200 and json.loads(data)["success"]


def test_http_preview_roundtrip(server):
    body = json.dumps({"path": "output/deck/a.html", "content": "<p>staged</p>"})
    status, data = _request(server, "POST", "/api/preview", body, {"Content-Type": "application/json"})
    assert status == 200
    url = json.loads(data)["url"]
    status, page = _request(server, "GET", url)
    assert status == 200 and page == b"<p>staged</p>"


def test_http_api_requires_same_origin_fetch(server):
    # Another port of 127.0.0.1 (the preview origin) is same-site, not same-origin.
    body = json.dumps({"path": "output/deck/a.html", "content": "<p>pwn</p>"})
    for site in ("same-site", "cross-site", "none", None):
        hdrs = {"Content-Type": "application/json", "Sec-Fetch-Site": site} if site else {"Content-Type": "application/json"}
        conn = http.client.HTTPConnection("127.0.0.1", server, timeout=5)
        conn.request("POST", "/api/save", body=body, headers={**_local(server), **{k: v for k, v in hdrs.items()}})
        res = conn.getresponse()
        res.read()
        conn.close()
        assert res.status == 403, site
    assert _request(server, "GET", "/api/config", headers={"Sec-Fetch-Site": "same-site"})[0] == 403


def test_http_api_requires_the_session_key(server, root):
    # Another program on the machine sends any header it likes, but not this run's key.
    before = (root / "output/deck/a.html").read_bytes()
    body = json.dumps({"path": "output/deck/a.html", "content": "<p>pwn</p>"})
    key = ed.HTMLEditorHandler.session_key
    calls = (("GET", "/api/config", None), ("GET", "/api/load?path=output/deck/a.html", None),
             ("GET", "/api/watch?path=output/deck/a.html", None), ("POST", "/api/save", body))
    # No key, a wrong one, a cookie (never read: a cookie goes to every port of the host), and a
    # key in the query of anything but the watch stream.
    for extra, query in (({}, ""), ({ed.SESSION_HEADER: "guess"}, ""), ({ed.SESSION_HEADER: key[:-1]}, ""),
                         ({"Cookie": f"htmldeck_session={key}"}, ""), ({}, f"&key={key}")):
        for method, path, data in calls:
            if path.startswith("/api/watch") and query:
                continue
            conn = http.client.HTTPConnection("127.0.0.1", server, timeout=5)
            url = path + (("&" if "?" in path else "?") + query[1:] if query else "")
            conn.request(method, url, body=data, headers={"Host": f"127.0.0.1:{server}", **extra, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json"})
            res = conn.getresponse()
            assert res.status == 403 and json.loads(res.read()).get("session") is True, (extra, query, path)
            conn.close()
    assert (root / "output/deck/a.html").read_bytes() == before
    # The watch stream: the key in its query (a wrong one refused).
    assert _request(server, "GET", "/api/watch?path=output/deck/a.html&key=guess")[0] == 403


def test_http_printed_link_hands_the_key_to_the_editor_in_the_fragment(server):
    def get(path):
        conn = http.client.HTTPConnection("127.0.0.1", server, timeout=5)
        conn.request("GET", path, headers={"Host": f"127.0.0.1:{server}"})
        res = conn.getresponse()
        data = res.read()
        conn.close()
        return res, data
    key = ed.HTMLEditorHandler.session_key
    res, _ = get(f"/?key={key}&file=output%2Fdeck%2Fa.html")
    # The key moves to the fragment (never sent to a server again); the file asked for is kept.
    assert res.status == 302 and res.getheader("Location") == f"/__htmldeck/index.html?file=output%2Fdeck%2Fa.html#key={key}"
    assert not res.getheader("Set-Cookie") and res.getheader("Cache-Control") == "no-store"   # it holds the key
    assert get(f"/__htmldeck/index.html?key={key}")[0].getheader("Location") == f"/__htmldeck/index.html#key={key}"
    # A wrong key gets a page saying which link to open.
    for path in ("/?key=guess", "/?key=", f"/index.html?key={key}x"):
        res, data = get(path)
        assert res.status == 403 and b"HTMLDECK_URL" in data and not res.getheader("Location"), path


def test_http_log_never_shows_a_session_key(server, capsys):
    key = ed.HTMLEditorHandler.session_key
    _request(server, "GET", _watch("/api/watch?path=../x.html"))
    _request(server, "GET", f"/?key={key}&file=/api/x.html")
    _request(server, "GET", f"/api/watch?path=../x.html&k%65y={key}")   # the name encoded
    out = capsys.readouterr().out
    assert "/api/watch?path=..%2Fx.html HTTP" in out and key not in out


def _head(port, path):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    conn.request("GET", path, headers={**_local(port)})
    res = conn.getresponse()
    res.read()
    conn.close()
    return res.status, res.getheader("Content-Security-Policy") or ""


def test_http_edit_preview_csp_blocks_remote_scripts_unless_trusted(server):
    for trust, remote in ((False, False), (True, True)):
        body = json.dumps({"path": "output/deck/a.html", "content": "<p>x</p>", "trust_remote": trust})
        url = json.loads(_request(server, "POST", "/api/preview", body, {"Content-Type": "application/json"})[1])["url"]
        status, csp = _head(server, url)
        assert status == 200 and "worker-src 'none'" in csp
        assert ("script-src *" in csp) == remote
        assert ("connect-src 'self'" in csp) == (not remote)


def test_http_preview_of_untrusted_document_runs_only_the_editors_scripts(server):
    json_hdr = {"Content-Type": "application/json"}
    nonce = "a1" * 16
    for extra, want in (({"nonce": nonce}, f"script-src 'nonce-{nonce}'"), ({"no_scripts": True}, "script-src 'none'")):
        # trust_remote cannot loosen it: the nonce policy wins.
        body = json.dumps({"path": None, "content": "<p>x</p>", "trust_remote": True, **extra})
        url = json.loads(_request(server, "POST", "/api/preview", body, json_hdr)[1])["url"]
        status, csp = _head(server, url)
        assert status == 200 and csp.startswith(want) and "unsafe-inline" not in csp and "connect-src 'none'" in csp
    # No path (a file from the computer) and no nonce: refused, never staged with the open policy.
    assert _request(server, "POST", "/api/preview", json.dumps({"path": None, "content": "<p>x</p>"}), json_hdr)[0] == 400
    for bad in ("short", "x' 'unsafe-inline", 7):
        body = json.dumps({"path": None, "content": "<p>x</p>", "nonce": bad})
        assert _request(server, "POST", "/api/preview", body, json_hdr)[0] == 400, bad


def test_http_workspace_html_is_sandboxed_on_editor_origin(server, root):
    status, csp = _head(server, "/output/deck/a.html")
    assert status == 200 and csp.startswith("sandbox")
    # A directory URL serving its index.html, and an SVG opened as a document, likewise.
    (root / "output/demo").mkdir(parents=True)
    (root / "output/demo/index.html").write_text("<script>x()</script>", encoding="utf-8")
    (root / "output/demo/pic.svg").write_text("<svg xmlns='http://www.w3.org/2000/svg'><script>x()</script></svg>", encoding="utf-8")
    for path in ("/output/demo/", "/output/demo/pic.svg"):
        status, csp = _head(server, path)
        assert status == 200 and csp.startswith("sandbox"), path


def test_preview_origin_serves_presented_documents_without_api(root):
    handler = type("H", (ed.HTMLEditorHandler,), {"root": root, "target_file": root / "output/deck/a.html"})
    handler.previews, handler.present_previews = ed.OrderedDict(), ed.OrderedDict()
    pv = type("P", (ed.PreviewOriginHandler,), {"root": root})
    ed.HTMLEditorHandler.present_previews = handler.present_previews
    a = ed.http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    b = ed.http.server.ThreadingHTTPServer(("127.0.0.1", 0), pv)
    for srv in (a, b):
        threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        handler.preview_origin = f"http://127.0.0.1:{b.server_address[1]}"
        body = json.dumps({"path": "output/deck/a.html", "content": "<p>show</p>", "target": "present"})
        url = json.loads(_request(a.server_address[1], "POST", "/api/preview", body, {"Content-Type": "application/json"})[1])["url"]
        assert url.startswith(handler.preview_origin)
        path = url[len(handler.preview_origin):]
        status, csp = _head(b.server_address[1], path)
        assert status == 200 and "worker-src 'none'" in csp
        assert _head(a.server_address[1], path)[0] == 404          # not on the editor origin
        assert _head(b.server_address[1], "/api/config")[0] == 404  # no API on the preview origin
        assert _head(b.server_address[1], "/output/deck/a.html")[0] == 200
        # A file from the computer presents with only the runtime's nonce-carrying scripts.
        body = json.dumps({"path": None, "content": "<p>show</p>", "target": "present", "nonce": "b2" * 16})
        url = json.loads(_request(a.server_address[1], "POST", "/api/preview", body, {"Content-Type": "application/json"})[1])["url"]
        status, csp = _head(b.server_address[1], url[len(handler.preview_origin):])
        assert status == 200 and f"script-src 'nonce-{'b2' * 16}'" in csp and "worker-src 'none'" in csp
    finally:
        for srv in (a, b):
            srv.shutdown()
            srv.server_close()


def test_http_does_not_follow_symlinks_out_of_root(server, root, tmp_path_factory):
    outside = tmp_path_factory.mktemp("secret")
    (outside / "id_rsa").write_text("KEY", encoding="utf-8")
    _symlink_or_skip(root / "output" / "link", outside)
    assert _request(server, "GET", "/output/link/id_rsa")[0] == 404


def test_concurrent_saves_with_same_mtime_only_one_wins(root):
    target = root / "output/deck/a.html"
    mtime = ed.load_html(target, root)["mtime_ns"]
    results = []

    def attempt(text):
        try:
            ed.save_html(target, text, mtime, False, root)
            results.append("ok")
        except ed.EditorError as exc:
            results.append(exc.status)

    threads = [threading.Thread(target=attempt, args=(f"<p>{i}</p>",)) for i in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results.count("ok") == 1 and results.count(409) == 5
    assert not list(target.parent.glob(".a.html.tmp.*"))


def _note(**over):
    base = {"id": "n1", "note": "Rename the title", "status": "open", "created": "2026-09-27", "selector": "#h1", "tag": "h1", "text": "Game Growth", "line": 3, "slide": 0}
    base.update(over)
    return base


def test_notes_roundtrip_live_beside_document_not_inside(root):
    target = root / "output/deck/a.html"
    res = ed.write_notes(target, [_note()], root)
    assert res["count"] == 1 and res["notes_file"] == f"output/deck/{ed.NOTES_DIR_NAME}/a.html.json"
    assert ed.read_notes(target)[0]["note"] == "Rename the title"
    assert target.read_text(encoding="utf-8") == "<p>a</p>"


@pytest.mark.parametrize("bad", [_note(status="later"), _note(note="  "), _note(id=""), "x", _note(selector=5)])
def test_notes_reject_invalid_entries(root, bad):
    with pytest.raises(ed.EditorError):
        ed.write_notes(root / "output/deck/a.html", [bad], root)


def test_list_notes_relocates_line_by_text(root):
    from htmldeck import notes as ln
    target = root / "output/deck/a.html"
    target.write_text("<html>\n<body>\n\n<h1>Game Growth</h1>\n</body></html>", encoding="utf-8")
    out = ln.format_notes(target, [_note(), _note(id="n2", status="done")], show_all=False)
    assert "line 4" in out and "slide 1" in out and "n2" not in out


def test_list_notes_prefers_occurrence_nearest_pinned_line():
    from htmldeck import notes as ln
    source = "<nav>Agenda</nav>\n" + "\n" * 10 + "<h2>Agenda</h2>\n"
    assert ln.current_line(source, _note(text="Agenda", line=12)) == 12
    assert ln.current_line(source, _note(text="Agenda", line=None)) == 1
    assert ln.current_line(source, _note(text="missing", line=7)) == 7


def test_note_ops_merge_against_disk_not_stale_client_copy(root):
    target = root / "output/deck/a.html"
    ed.apply_note_ops(target, [{"op": "add", "note": _note(id="A")}], root)
    # agent marks A done; an editor holding a stale list then adds B
    ed.apply_note_ops(target, [{"op": "update", "id": "A", "patch": {"status": "done"}}], root)
    res = ed.apply_note_ops(target, [{"op": "add", "note": _note(id="B")}], root)
    assert [(n["id"], n["status"]) for n in res["notes"]] == [("A", "done"), ("B", "open")]
    res = ed.apply_note_ops(target, [{"op": "delete", "id": "A"}], root)
    assert [n["id"] for n in res["notes"]] == ["B"]
    with pytest.raises(ed.EditorError):
        ed.apply_note_ops(target, [{"op": "add", "note": _note(id="B")}], root)


def _region(**over):
    base = _note(id="r1", selector="section:nth-of-type(2)", tag="section", text="Q3", line=40, slide=1)
    base.update(kind="region", region={"x": 80, "y": 120.25, "width": 600, "height": 240}, canvas={"width": 1280, "height": 720},
                targets=[{"selector": "#h2", "tag": "h2", "text": "Growth", "line": 42}, {"selector": "#img", "tag": "img", "text": "", "line": None}])
    base.update(over)
    return base


def test_region_note_roundtrip_keeps_geometry_and_targets(root):
    target = root / "output/deck/a.html"
    ed.write_notes(target, [_region(), _note()], root)
    region, legacy = ed.read_notes(target)
    assert region["kind"] == "region" and region["region"] == {"x": 80, "y": 120.25, "width": 600, "height": 240}
    assert region["canvas"] == {"width": 1280, "height": 720}
    assert [t["selector"] for t in region["targets"]] == ["#h2", "#img"] and region["targets"][1]["line"] is None
    # an element note stays exactly as before: no new keys appear
    assert set(legacy) == set(_note())


@pytest.mark.parametrize("bad", [
    _region(kind="box"),
    _region(region=None),
    _region(region={"x": 0, "y": 0, "width": 0, "height": 10}),
    _region(region={"x": 0, "y": 0, "width": float("nan"), "height": 10}),
    _region(region={"x": True, "y": 0, "width": 5, "height": 10}),
    _region(canvas={"width": -1, "height": 720}),
    _region(targets="x"),
    _region(targets=[{"selector": 5}]),
    _region(targets=[{"selector": "#a", "tag": "p", "text": "", "line": None}] * 13),
])
def test_region_note_rejects_invalid_geometry_and_targets(root, bad):
    with pytest.raises(ed.EditorError):
        ed.write_notes(root / "output/deck/a.html", [bad], root)


def test_region_note_reanchor_patch_keeps_concurrent_done(root):
    target = root / "output/deck/a.html"
    ed.apply_note_ops(target, [{"op": "add", "note": _region()}], root)
    ed.apply_note_ops(target, [{"op": "update", "id": "r1", "patch": {"status": "done"}}], root)
    moved = [{"selector": "#h2b", "tag": "h2", "text": "Growth", "line": 50}]
    res = ed.apply_note_ops(target, [{"op": "update", "id": "r1", "patch": {"selector": "section:nth-of-type(3)", "line": 48, "targets": moved, "region": {"x": 1, "y": 1, "width": 1, "height": 1}}}], root)
    (note,) = res["notes"]
    assert note["status"] == "done" and note["selector"] == "section:nth-of-type(3)" and note["targets"] == moved
    assert note["region"]["x"] == 80   # the drawn region is a capture snapshot: not patchable


def test_list_notes_prints_region_and_targets(root):
    from htmldeck import notes as ln
    target = root / "output/deck/a.html"
    target.write_text("<section>\n<h2 id=h2>Growth</h2>\n</section>", encoding="utf-8")
    out = ln.format_notes(target, [_region(), _region(id="r2", targets=[])], show_all=False)
    assert "region x=80 y=120 width 600 height 240" in out and "slide, 1280×720" in out
    assert "1) <h2> #h2 · line 2 · \"Growth\"" in out and "2) <img> #img" in out
    assert "elements in it: none" in out


def test_notes_prompt_is_ready_to_paste(root):
    from htmldeck import notes as ln
    target = root / "output/deck/a b.html"
    target.write_text("<h1>Game Growth</h1>", encoding="utf-8")
    out = ln.format_prompt(target, [_note(), _region(), _note(id="n9", status="done")], root)
    assert out.startswith("Edit output/deck/a b.html as asked in the 2 note(s)")
    assert "n9" not in out and "id=r1" in out and "#h2" in out
    assert out.rstrip().endswith(ed.notes_commands(target, root)[-1]["command"] + " --done ID")


def test_notes_command_quotes_for_the_shell_of_the_machine(root):
    import shlex
    target = root / "output/deck/10月改版 台灣's 提案.html"
    posix = ed.notes_command(target, root, "posix")
    assert shlex.split(posix)[2:] == ["--root", str(root), "--file", "output/deck/10月改版 台灣's 提案.html"]
    ps = ed.notes_command(target, root, "powershell")
    assert ps.startswith("& '") and "--file 'output/deck/10月改版 台灣''s 提案.html'" in ps
    curly = ed.notes_command(root / "Bob’s ‘deck’.html", root, "powershell")
    assert curly.endswith("--file 'Bob’’s ‘‘deck’’.html'")
    # A name that looks like an option is still read as the file.
    assert "--file ./-x.html" in ed.notes_command(root / "-x.html", root)
    # Windows: one command per shell an agent may use there, each labelled.
    assert [c["shell"] for c in ed.notes_commands(target, root, windows=True)] == ["PowerShell", "Git Bash"]
    assert [c["shell"] for c in ed.notes_commands(target, root, windows=False)] == [""]


def test_notes_api_hands_the_editor_the_agent_command(server, root):
    status, data = _request(server, "GET", "/api/notes?path=output/deck/a.html")
    assert status == 200 and json.loads(data)["commands"] == ed.notes_commands(root / "output/deck/a.html", root)
    body = json.dumps({"path": "output/deck/a.html", "ops": [{"op": "add", "note": _note()}]})
    ok = {"Content-Type": "application/json", "Origin": f"http://127.0.0.1:{server}"}
    status, data = _request(server, "POST", "/api/notes", body, ok)
    data = json.loads(data)
    assert status == 200 and data["commands"] and data["notes"][0]["id"] == "n1"


@pytest.mark.parametrize("args", [[], ["--prompt"], ["--done", "n1"]])
def test_notes_cli_rejects_a_missing_or_folder_target(root, capsys, args):
    from htmldeck import notes as ln
    for name in ("output/deck/nope.html", "output/deck"):
        with pytest.raises(SystemExit) as exc:
            ln.main(["--root", str(root), "--file", name, *args])
        assert exc.value.code == 1 and "not a file" in capsys.readouterr().err


def test_notes_cli_existing_file_without_notes_is_fine(root, capsys):
    from htmldeck import notes as ln
    ln.main(["--root", str(root), "--file", "output/deck/a.html"])
    assert "No open notes" in capsys.readouterr().out


def test_http_symlink_into_hidden_dir_is_blocked(server, root):
    _symlink_or_skip(root / "output" / "alias", root / "output" / ".hidden")
    assert _request(server, "GET", "/output/alias/secret.html")[0] == 404


def test_editor_assets_have_pinned_mime_even_if_host_table_is_wrong(monkeypatch):
    import mimetypes

    # A host mime.types that maps .mjs/.css wrongly must not reach the browser.
    monkeypatch.setitem(mimetypes.types_map, ".mjs", "application/octet-stream")
    monkeypatch.setitem(mimetypes.types_map, ".css", "text/plain")
    handler = ed.HTMLEditorHandler.__new__(ed.HTMLEditorHandler)
    assert handler.guess_type("htmldeck/web/js/app.mjs") == "text/javascript"
    assert handler.guess_type("htmldeck/web/css/editor.css") == "text/css"
    assert handler.guess_type("output/x/pic.svg") == "image/svg+xml"



def test_server_listen_backlog_holds_a_burst_of_module_requests():
    # The editor is ~40 ES modules fetched at once (more with several tabs open); with
    # socketserver's default backlog of 5 the OS reset the extra connections, a module failed
    # to load and the editor stayed blank with no page error.
    backlog = []

    class FakeSocket:
        def listen(self, n):
            backlog.append(n)

    srv = ed.LocalServer(("127.0.0.1", 0), ed.HTMLEditorHandler, bind_and_activate=False)
    real, srv.socket = srv.socket, FakeSocket()
    try:
        srv.server_activate()
    finally:
        real.close()
    assert backlog == [128]


# --- live sync: revisions and the watch stream --------------------------------------------

def test_load_and_save_report_the_revision_of_the_bytes(root):
    target = root / "output/deck/a.html"
    loaded = ed.load_html(target, root)
    assert loaded["rev"] == ed.revision(target.read_bytes())
    saved = ed.save_html(target, "<p>b</p>", None, False, root, loaded["rev"])
    assert saved["rev"] == ed.revision(target.read_bytes()) != loaded["rev"]


def test_save_with_a_revision_catches_a_change_that_kept_the_mtime(root):
    target = root / "output/deck/a.html"
    loaded = ed.load_html(target, root)
    st = target.stat()
    target.write_text("<p>agent</p>", encoding="utf-8")
    os.utime(target, ns=(st.st_atime_ns, st.st_mtime_ns))   # same mtime, other bytes
    with pytest.raises(ed.EditorError) as exc:
        ed.save_html(target, "<p>mine</p>", loaded["mtime_ns"], False, root, loaded["rev"])
    assert exc.value.status == 409
    assert target.read_text(encoding="utf-8") == "<p>agent</p>"


class _Clock:
    def __init__(self):
        self.t = 0.0

    def __call__(self):
        return self.t


def _settle(watch, clock, rounds=3):
    events = []
    for _ in range(rounds):
        clock.t += ed.WATCH_SETTLE_S + 0.01   # past it, whatever the float rounding
        events += watch.poll()
    return events


def test_watch_reports_a_change_once_it_rests(root):
    target, clock = root / "output/deck/a.html", _Clock()
    watch = ed.DocWatch(target, ed.load_html(target, root)["rev"], clock)
    assert _settle(watch, clock) == []
    target.write_text("<p>agent 1</p>", encoding="utf-8")
    assert watch.poll() == []   # just changed: may still be written
    events = _settle(watch, clock)
    assert [e["type"] for e in events] == ["doc"] and events[0]["rev"] == ed.revision(target.read_bytes())
    assert _settle(watch, clock) == []


def test_watch_tells_a_stale_tab_at_once_and_ignores_its_own_revision(root):
    target, clock = root / "output/deck/a.html", _Clock()
    old = ed.load_html(target, root)["rev"]
    target.write_text("<p>agent</p>", encoding="utf-8")
    assert [e["type"] for e in ed.DocWatch(target, old, clock).poll()] == ["doc"]   # first poll, no wait
    current = ed.revision(target.read_bytes())
    assert _settle(ed.DocWatch(target, current, clock), clock) == []


def test_watch_waits_for_a_file_written_as_delete_and_create(root):
    target, clock = root / "output/deck/a.html", _Clock()
    watch = ed.DocWatch(target, ed.load_html(target, root)["rev"], clock)
    _settle(watch, clock)
    target.unlink()
    assert _settle(watch, clock) == []
    target.write_text("<p>new</p>", encoding="utf-8")
    assert [e["type"] for e in _settle(watch, clock)] == ["doc"]


def test_watch_reports_the_notes_sidecar(root):
    target, clock = root / "output/deck/a.html", _Clock()
    watch = ed.DocWatch(target, ed.load_html(target, root)["rev"], clock)
    _settle(watch, clock)
    ed.write_notes(target, [{"id": "n1", "note": "fix", "status": "open"}], root)
    assert [e["type"] for e in _settle(watch, clock)] == ["notes"]


def test_http_watch_streams_events_and_guards_the_path(server, root):
    assert _request(server, "GET", _watch("/api/watch?path=../x.html"))[0] == 403
    assert _request(server, "GET", _watch("/api/watch?path=output/deck/a.html"), headers={"Sec-Fetch-Site": "cross-site"})[0] == 403
    conn = http.client.HTTPConnection("127.0.0.1", server, timeout=5)
    conn.request("GET", _watch("/api/watch?path=output/deck/a.html&rev=stale"), headers={**_local(server), "Sec-Fetch-Site": "same-origin"})
    res = conn.getresponse()
    assert res.status == 200 and res.getheader("Content-Type").startswith("text/event-stream")
    seen = b""
    while b"event: doc" not in seen:
        seen += res.fp.readline()
    assert b'"rev"' in res.fp.readline()
    res.close()
    conn.close()


def test_watch_tries_again_when_the_file_is_locked_for_a_moment(root, monkeypatch):
    target, clock = root / "output/deck/a.html", _Clock()
    watch = ed.DocWatch(target, ed.load_html(target, root)["rev"], clock)
    _settle(watch, clock)
    target.write_text("<p>agent</p>", encoding="utf-8")
    real, calls = ed._snapshot, []

    def locked_once(path):
        calls.append(path)
        if len(calls) == 1:
            raise PermissionError("sharing violation")
        return real(path)
    monkeypatch.setattr(ed, "_snapshot", locked_once)
    assert [e["type"] for e in _settle(watch, clock)] == ["doc"] and len(calls) == 2


def test_save_reports_the_revision_of_what_it_wrote(root):
    target = root / "output/deck/a.html"
    target.write_bytes(b"\xef\xbb\xbf<p>bom</p>")
    loaded = ed.load_html(target, root)
    saved = ed.save_html(target, "<p>new</p>", None, False, root, loaded["rev"])
    assert saved["rev"] == ed.revision(b"\xef\xbb\xbf<p>new</p>") == ed.revision(target.read_bytes())


def test_http_watch_lets_go_of_a_closed_tab_at_once(server):
    free = ed.WATCH_SLOTS._value
    conn = http.client.HTTPConnection("127.0.0.1", server, timeout=5)
    conn.request("GET", _watch("/api/watch?path=output/deck/a.html"), headers={**_local(server), "Sec-Fetch-Site": "same-origin"})
    res = conn.getresponse()
    res.fp.readline()
    assert ed.WATCH_SLOTS._value == free - 1
    res.close()   # the response holds the socket too
    conn.close()
    deadline = time.monotonic() + 3   # well before the 15 s ping
    while ed.WATCH_SLOTS._value != free and time.monotonic() < deadline:
        time.sleep(0.05)
    assert ed.WATCH_SLOTS._value == free


# ---- sidecars (.htmldeck_bak / .htmldeck_notes) never lead outside the document's folder
def _outside(tmp_path_factory):
    d = tmp_path_factory.mktemp("outside")
    return d.resolve()


def test_save_refuses_a_backup_folder_that_is_a_symlink(root, tmp_path_factory):
    out = _outside(tmp_path_factory)
    target = root / "output/deck/a.html"
    _symlink_or_skip(target.parent / ed.BACKUP_DIR_NAME, out)
    mtime = ed.load_html(target, root)["mtime_ns"]
    with pytest.raises(ed.EditorError) as exc:
        ed.save_html(target, "<p>b</p>", mtime, False, root)
    assert exc.value.status == 403
    assert list(out.iterdir()) == [] and target.read_text(encoding="utf-8") == "<p>a</p>"


def test_notes_refuse_a_notes_folder_that_is_a_symlink(root, tmp_path_factory):
    out = _outside(tmp_path_factory)
    target = root / "output/deck/a.html"
    _symlink_or_skip(target.parent / ed.NOTES_DIR_NAME, out)
    with pytest.raises(ed.EditorError) as exc:
        ed.write_notes(target, [_note()], root)
    assert exc.value.status == 403 and list(out.iterdir()) == []
    with pytest.raises(ed.EditorError):
        ed.read_notes(target)


def test_notes_refuse_symlinked_lock_and_notes_files(root, tmp_path_factory):
    out = _outside(tmp_path_factory)
    target = root / "output/deck/a.html"
    notes_dir = target.parent / ed.NOTES_DIR_NAME
    notes_dir.mkdir()
    try:
        (notes_dir / ".lock").symlink_to(out / "lock-target")
    except OSError as exc:
        pytest.skip(f"symlinks not permitted: {exc}")
    with pytest.raises(ed.EditorError):
        ed.write_notes(target, [_note()], root)
    assert not (out / "lock-target").exists()
    (notes_dir / ".lock").unlink()
    (out / "secret.json").write_text('{"notes": [{"id": "x", "note": "outside secret"}]}', encoding="utf-8")
    (notes_dir / "a.html.json").symlink_to(out / "secret.json")
    with pytest.raises(ed.EditorError):
        ed.read_notes(target)


# ---- workspace trust: a workspace's own scripts never run in the edit view until trusted
def test_workspace_scripts_are_off_until_the_workspace_is_trusted(untrusted_server, root, config_dir):
    port, hdr = untrusted_server, {"Content-Type": "application/json"}
    cfg = lambda: json.loads(_request(port, "GET", "/api/config")[1])
    assert cfg()["trusted"] is False
    body = json.dumps({"path": "output/deck/a.html", "content": "<p>x</p>"})
    status, data = _request(port, "POST", "/api/preview", body, hdr)
    assert status == 400 and b"trust" in data.lower()          # the open policy is never staged
    nonce = "c3" * 16
    body = json.dumps({"path": "output/deck/a.html", "content": "<p>x</p>", "nonce": nonce, "trust_remote": True})
    url = json.loads(_request(port, "POST", "/api/preview", body, hdr)[1])["url"]
    assert _head(port, url)[1].startswith(f"script-src 'nonce-{nonce}'")
    # Trusting is remembered for this workspace (user config), across restarts.
    status, data = _request(port, "POST", "/api/trust", json.dumps({"trusted": True}), hdr)
    assert status == 200 and json.loads(data)["trusted"] is True and cfg()["trusted"] is True
    assert str(root) in json.loads((config_dir / "trusted-workspaces.json").read_text(encoding="utf-8"))["roots"]   # parsed: JSON escapes Windows backslashes
    body = json.dumps({"path": "output/deck/a.html", "content": "<p>x</p>"})
    url = json.loads(_request(port, "POST", "/api/preview", body, hdr)[1])["url"]
    assert "'unsafe-inline'" in _head(port, url)[1]
    again = _serve(root)
    try:
        assert json.loads(_request(again.server_address[1], "GET", "/api/config")[1])["trusted"] is True
    finally:
        again.shutdown()
        again.server_close()
    _request(port, "POST", "/api/trust", json.dumps({"trusted": False}), hdr)
    assert cfg()["trusted"] is False
    assert _request(port, "POST", "/api/trust", json.dumps({"trusted": "yes"}), hdr)[0] == 400


def test_sidecar_folder_must_be_itself_not_a_redirect(root, tmp_path_factory, monkeypatch):
    # A Windows junction is not a symlink to Path.is_symlink(); the folder must still resolve
    # to itself beside the document.
    out = _outside(tmp_path_factory)
    target = root / "output/deck/a.html"
    _symlink_or_skip(target.parent / ed.NOTES_DIR_NAME, out)
    monkeypatch.setattr(ed, "_is_link", lambda path: False)   # what a junction looks like
    with pytest.raises(ed.EditorError):
        ed.write_notes(target, [_note()], root)
    assert list(out.iterdir()) == []


@pytest.mark.skipif(not ed._DIR_FD, reason="needs dir_fd (POSIX)")
def test_sidecar_swapped_for_a_symlink_after_the_check_is_not_followed(root, tmp_path_factory, monkeypatch):
    out = _outside(tmp_path_factory)
    target = root / "output/deck/a.html"
    notes = target.parent / ed.NOTES_DIR_NAME

    def swap(folder):   # the race: right after HTML Deck checked and opened the folder
        if folder.name == ed.NOTES_DIR_NAME and not folder.is_symlink():
            folder.rename(folder.with_name(".moved"))
            folder.symlink_to(out, target_is_directory=True)
    monkeypatch.setattr(ed, "_sidecar_opened", swap)
    ed.write_notes(target, [_note()], root)
    assert list(out.iterdir()) == []                       # nothing written through the link
    assert (target.parent / ".moved" / "a.html.json").is_file()
    notes.unlink()
    (target.parent / ".moved").rename(notes)

    def swap_backup(folder):
        if folder.name == ed.BACKUP_DIR_NAME and not folder.is_symlink():
            folder.rename(folder.with_name(".moved-bak"))
            folder.symlink_to(out, target_is_directory=True)
    monkeypatch.setattr(ed, "_sidecar_opened", swap_backup)
    mtime = ed.load_html(target, root)["mtime_ns"]
    ed.save_html(target, "<p>b</p>", mtime, False, root)
    assert list(out.iterdir()) == [] and list((target.parent / ".moved-bak").glob("a.html.*.bak"))


@pytest.mark.skipif(not ed._DIR_FD, reason="needs dir_fd (POSIX)")
def test_notes_folder_created_as_a_link_after_the_check_is_not_read(root, tmp_path_factory, monkeypatch):
    out = _outside(tmp_path_factory)
    (out / "a.html.json").write_text('{"notes": [{"id": "x", "note": "outside secret"}]}', encoding="utf-8")
    target = root / "output/deck/a.html"

    def plant(folder):   # the folder was absent when checked; a link appears right after
        if folder.name == ed.NOTES_DIR_NAME and not folder.exists():
            folder.symlink_to(out, target_is_directory=True)
    monkeypatch.setattr(ed, "_sidecar_opened", plant)
    assert ed.read_notes(target) == []


@pytest.mark.skipif(os.name == "nt", reason="POSIX permissions")
def test_backup_keeps_the_documents_permissions(root):
    target = root / "output/deck/a.html"
    target.chmod(0o600)
    mtime = ed.load_html(target, root)["mtime_ns"]
    ed.save_html(target, "<p>b</p>", mtime, False, root)
    backup = next((target.parent / ed.BACKUP_DIR_NAME).glob("a.html.*.bak"))
    assert backup.stat().st_mode & 0o777 == 0o600


def test_editor_files_share_one_connection(server):
    # The editor loads ~65 modules per page: one TCP connection each ran Windows out of socket
    # buffers (net::ERR_NO_BUFFER_SPACE). They are kept alive on one connection now.
    conn = http.client.HTTPConnection("127.0.0.1", server, timeout=5)
    hdrs = {**_local(server)}
    for path in ("/__htmldeck/js/app.mjs", "/__htmldeck/css/editor.css", "/", "/__htmldeck/index.html"):
        conn.request("GET", path, headers=hdrs)
        res = conn.getresponse()
        res.read()
        assert res.status in (200, 302) and not res.will_close, path
    # Per-request state does not leak to the next request on the connection: a workspace
    # file's sandbox CSP must not land on the editor page that follows.
    conn.request("GET", "/output/deck/a.html", headers=hdrs)
    res = conn.getresponse()
    res.read()
    assert (res.getheader("Content-Security-Policy") or "").startswith("sandbox")
    conn.request("GET", "/__htmldeck/index.html", headers=hdrs)
    res = conn.getresponse()
    res.read()
    assert "sandbox" not in (res.getheader("Content-Security-Policy") or "")
    # A POST (its body may go unread on an error) ends its connection.
    conn.request("POST", "/api/nope", body="{}", headers={**hdrs, "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin"})
    res = conn.getresponse()
    res.read()
    assert res.will_close
    conn.close()


def test_get_with_a_body_ends_its_connection(server):
    # A GET body is never read: kept alive, its bytes would be parsed as a second request.
    smuggled = f"GET /__htmldeck/index.html HTTP/1.1\r\nHost: 127.0.0.1:{server}\r\n\r\n".encode()
    with socket.create_connection(("127.0.0.1", server), timeout=5) as sock:
        sock.sendall(f"GET /api/config HTTP/1.1\r\nHost: 127.0.0.1:{server}\r\nContent-Length: {len(smuggled)}\r\n\r\n".encode() + smuggled)
        data = b""
        while chunk := sock.recv(65536):
            data += chunk
    assert data.startswith(b"HTTP/1.1 403")
    assert data.count(b"HTTP/1.1 ") == 1   # the body was not served as a request of its own


def test_backups_kept_are_the_newest_even_within_one_second(root, monkeypatch):
    # The stamp's sub-second part came from another clock reading: saves in the same second
    # sorted at random, and pruning could drop the newest backup.
    target = root / "output/deck/a.html"
    old = target.parent / ed.BACKUP_DIR_NAME
    old.mkdir()
    (old / "a.html.20260101-120000-999999.bak").write_text("legacy", encoding="utf-8")   # a 0.1.11 name
    ns = iter(range(1_767_268_800_000_000_000, 1_767_268_800_000_000_000 + 2_100_000, 300_000))   # wraps the old 6-digit suffix
    monkeypatch.setattr(ed.time, "time_ns", lambda: next(ns))
    for i in range(7):
        ed.save_html(target, f"<p>{i}</p>", None, True, root)
    listed = ed.list_backups(target, root)["backups"]
    assert len(listed) == ed.BACKUPS_KEPT
    # Newest first: the versions before saves 6, 5, 4, 3, 2 (save i backed up "<p>i-1</p>").
    contents = [(old / b["name"]).read_text(encoding="utf-8") for b in listed]
    assert contents == ["<p>5</p>", "<p>4</p>", "<p>3</p>", "<p>2</p>", "<p>1</p>"]
    assert not (old / "a.html.20260101-120000-999999.bak").exists()


def test_restore_writes_a_backup_back_as_a_save(root):
    target = root / "output/deck/a.html"
    first = ed.load_html(target, root)
    ed.save_html(target, "<p>b</p>", None, False, root, first["rev"])
    name = ed.list_backups(target, root)["backups"][0]["name"]
    with pytest.raises(ed.EditorError) as stale:   # a tab behind the file
        ed.restore_backup(target, name, first["rev"], root)
    assert stale.value.status == 409
    now = ed.load_html(target, root)
    res = ed.restore_backup(target, name, now["rev"], root)
    assert target.read_text(encoding="utf-8") == "<p>a</p>" and res["restored"] == name
    # The version it replaced is a backup in turn.
    texts = {(target.parent / ed.BACKUP_DIR_NAME / b["name"]).read_text(encoding="utf-8") for b in ed.list_backups(target, root)["backups"]}
    assert "<p>b</p>" in texts


@pytest.mark.parametrize("name", ["../a.html", "a.html", "b.html.20260101-120000-000000001.bak", "x/a.html.20260101-120000-000000001.bak", None])
def test_restore_takes_only_a_kept_backup_of_this_document(root, name):
    target = root / "output/deck/a.html"
    with pytest.raises(ed.EditorError) as err:
        ed.restore_backup(target, name, ed.load_html(target, root)["rev"], root)
    assert err.value.status == 400


def test_http_backups_and_restore_need_the_session_key(server):
    conn = http.client.HTTPConnection("127.0.0.1", server, timeout=5)
    conn.request("GET", "/api/backups?path=output/deck/a.html", headers={"Host": f"127.0.0.1:{server}", "Sec-Fetch-Site": "same-origin"})
    res = conn.getresponse()
    res.read()
    assert res.status == 403
    conn.request("GET", "/api/backups?path=output/deck/a.html", headers={**_local(server), "Sec-Fetch-Site": "same-origin"})
    res = conn.getresponse()
    assert res.status == 200 and json.loads(res.read())["backups"] == []
    conn.close()


def test_history_shows_when_each_version_was_saved_and_refuses_an_empty_one(root):
    target = root / "output/deck/a.html"
    os.utime(target, (1_700_000_000, 1_700_000_000))
    ed.save_html(target, "<p>b</p>", None, True, root)
    [kept] = ed.list_backups(target, root)["backups"]
    assert kept["time"] == ed.time.strftime("%Y-%m-%d %H:%M:%S", ed.time.localtime(1_700_000_000))
    (target.parent / ed.BACKUP_DIR_NAME / kept["name"]).write_text("  \n", encoding="utf-8")
    with pytest.raises(ed.EditorError) as err:
        ed.restore_backup(target, kept["name"], ed.load_html(target, root)["rev"], root)
    assert err.value.status == 422 and target.read_text(encoding="utf-8") == "<p>b</p>"


def test_backup_order_does_not_repeat_when_the_clocks_go_back(root, monkeypatch):
    # Stamps are UTC: a local 01:59:59 then 01:00:00 (fall back) must still prune the oldest.
    target = root / "output/deck/a.html"
    start = 1_793_512_799_000_000_000   # 2026-11-01 05:59:59 UTC (01:59:59 EDT)
    ns = iter([start + i * 1_000_000_000 for i in range(7)])
    monkeypatch.setattr(ed.time, "time_ns", lambda: next(ns))
    for i in range(7):
        ed.save_html(target, f"<p>{i}</p>", None, True, root)
    names = [b["name"] for b in ed.list_backups(target, root)["backups"]]
    side = target.parent / ed.BACKUP_DIR_NAME
    assert [(side / n).read_text(encoding="utf-8") for n in names] == ["<p>5</p>", "<p>4</p>", "<p>3</p>", "<p>2</p>", "<p>1</p>"]
    assert all(n.endswith("Z.bak") for n in names)


@pytest.mark.skipif(not hasattr(os, "mkfifo"), reason="no FIFOs here")
def test_restore_refuses_a_backup_that_is_not_a_plain_file(root):
    target = root / "output/deck/a.html"
    ed.save_html(target, "<p>b</p>", None, True, root)
    [kept] = ed.list_backups(target, root)["backups"]
    path = target.parent / ed.BACKUP_DIR_NAME / kept["name"]
    path.unlink()
    os.mkfifo(path)
    with pytest.raises(ed.EditorError) as err:   # returns at once, never waits for a writer
        ed.restore_backup(target, kept["name"], ed.load_html(target, root)["rev"], root)
    assert err.value.status == 422
    path.unlink()
    path.mkdir()   # a folder: refused too, not a 500
    with pytest.raises(ed.EditorError) as err:
        ed.restore_backup(target, kept["name"], ed.load_html(target, root)["rev"], root)
    assert err.value.status == 422
