import base64
import http.server
import threading
from pathlib import Path

import pytest

from htmldeck import export as ex
from htmldeck import server as ed

PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=")


@pytest.fixture
def ws(tmp_path):
    (tmp_path / "deck" / "img").mkdir(parents=True)
    (tmp_path / "deck" / "img" / "a.png").write_bytes(PNG)
    (tmp_path / "deck" / "img" / "b c.png").write_bytes(PNG)
    (tmp_path / "deck" / "style.css").write_text("body{background:url('img/a.png')}\n@import 'more.css';", encoding="utf-8")
    (tmp_path / "deck" / "more.css").write_text(".x{color:red}", encoding="utf-8")
    (tmp_path / "deck" / "app.js").write_text("console.log('</script>')", encoding="utf-8")
    (tmp_path / ".env").write_text("TOKEN=1", encoding="utf-8")
    return tmp_path.resolve()


def run(ws, html, **kw):
    return ex.single_file(html, ws / "deck" / "index.html", ws, **kw)


def test_embeds_images_styles_and_scripts(ws):
    html = ('<link rel="stylesheet" href="style.css"><script src="app.js" defer></script>'
            '<img src="img/a.png" alt="A"><img srcset="img/a.png 1x, img/b%20c.png 2x">'
            '<div style="background-image:url(img/a.png)"></div>')
    out, rep = run(ws, html)
    assert "style.css" not in out and "app.js" not in out and "img/a.png" not in out and "b%20c" not in out
    assert out.count("data:image/png;base64,") == 5          # img, srcset ×2, inline style, CSS url()
    assert "<style>body{background:url(" in out and ".x{color:red}" in out   # @import inlined too
    assert '<img src="data:image/png;base64,' in out and 'alt="A"' in out
    assert "<\\/script>" in out and "</script>')" not in out   # a script cannot end itself early
    assert rep["embedded"] == 5 and rep["missing"] == [] and rep["remote"] == []


def test_leaves_data_uris_anchors_and_text_alone(ws):
    html = '<p>Visit img/a.png</p><a href="#top">x</a><img src="data:image/gif;base64,R0lG">'
    out, rep = run(ws, html)
    assert out == html and rep["embedded"] == 0


def test_never_embeds_outside_the_workspace_or_hidden_files(ws, tmp_path_factory):
    outside = tmp_path_factory.mktemp("out") / "x.png"
    outside.write_bytes(PNG)
    html = f'<img src="../.env"><img src="{outside.as_uri()}"><img src="../../x.png">'
    out, rep = run(ws, html)
    assert "TOKEN" not in out and "data:" not in out and rep["embedded"] == 0
    assert len(rep["missing"]) == 3


def test_missing_files_are_kept_and_reported(ws):
    out, rep = run(ws, '<img src="nope.png"><script src="gone.js"></script>')
    assert out == '<img src="nope.png"><script src="gone.js"></script>' and rep["missing"] == ["nope.png", "gone.js"]


@pytest.fixture
def cdn(tmp_path):
    (tmp_path / "lib.js").write_text("window.lib=1", encoding="utf-8")
    (tmp_path / "f.css").write_text("@font-face{src:url(font.woff2)}", encoding="utf-8")
    (tmp_path / "font.woff2").write_bytes(b"wOF2")
    handler = lambda *a, **k: http.server.SimpleHTTPRequestHandler(*a, directory=str(tmp_path), **k)
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


def test_remote_files_only_when_asked(ws, cdn, monkeypatch):
    monkeypatch.setattr(ex, "_public_addresses", lambda host: ["127.0.0.1"])   # the test CDN is on 127.0.0.1
    html = f'<script src="{cdn}/lib.js" integrity="sha384-x" crossorigin="anonymous"></script><link rel="stylesheet" href="{cdn}/f.css">'
    out, rep = run(ws, html)
    assert out == html and rep["remote"] == [f"{cdn}/lib.js", f"{cdn}/f.css"]   # listed, not fetched
    out, rep = run(ws, html, fetch_remote=True)
    assert "window.lib=1" in out and "integrity" not in out and cdn not in out
    assert "@font-face{src:url(data:font/woff2;base64," in out and rep["remote"] == [] and rep["embedded"] == 3


def test_export_api_uses_the_documents_folder(tmp_path):
    (tmp_path / "d").mkdir()
    (tmp_path / "d" / "p.png").write_bytes(PNG)
    (tmp_path / "d" / "x.html").write_text("<p>x</p>", encoding="utf-8")
    res = ed.export_html(tmp_path / "d" / "x.html", '<img src="p.png">', tmp_path.resolve(), fetch_remote=False)
    assert res["html"].startswith('<img src="data:image/png;base64,') and res["embedded"] == 1


def test_only_web_assets_are_embedded_from_the_workspace(ws):
    (ws / "deck" / "credentials.txt").write_text("password=hunter2", encoding="utf-8")
    (ws / "deck" / "data.json").write_text('{"k": 1}', encoding="utf-8")
    html = '<img src="credentials.txt"><link rel="stylesheet" href="data.json"><img src="img/a.png">'
    out, rep = run(ws, html)
    assert "hunter2" not in out and base64.b64encode(b"password=hunter2").decode() not in out
    assert '"k": 1' not in out and base64.b64encode(b'{"k": 1}').decode() not in out
    assert rep["embedded"] == 1 and sorted(rep["missing"]) == ["credentials.txt", "data.json"]


@pytest.fixture
def redirector(tmp_path):
    (tmp_path / "secret.js").write_text("window.secret=1", encoding="utf-8")

    class H(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=str(tmp_path), **k)

        def do_GET(self):
            if self.path == "/go":
                self.send_response(302)
                self.send_header("Location", f"http://localhost:{self.server.server_address[1]}/secret.js")
                self.end_headers()
                return
            super().do_GET()

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}"
    srv.shutdown()


def test_remote_export_never_reaches_local_or_private_addresses(ws, redirector, monkeypatch):
    out, rep = run(ws, f'<script src="{redirector}/secret.js"></script>', fetch_remote=True)
    assert "window.secret" not in out and rep["missing"] == [f"{redirector}/secret.js"]
    for host in ("localhost", "127.0.0.1", "10.0.0.1", "192.168.1.1", "169.254.169.254", "[::1]"):
        assert not ex._host_allowed(host.strip("[]")), host
    # A public-looking first hop that redirects to localhost is refused at the redirect.
    monkeypatch.setattr(ex, "_public_addresses", lambda host, real=ex._public_addresses: ["127.0.0.1"] if host == "127.0.0.1" else real(host))
    out, rep = run(ws, f'<script src="{redirector}/go"></script>', fetch_remote=True)
    assert "window.secret" not in out and rep["missing"] == [f"{redirector}/go"]


def test_remote_export_has_a_total_size_budget(ws, cdn, monkeypatch):
    monkeypatch.setattr(ex, "_public_addresses", lambda host: ["127.0.0.1"])
    monkeypatch.setattr(ex, "MAX_REMOTE_TOTAL", 20)
    out, rep = run(ws, f'<script src="{cdn}/lib.js"></script><script src="{cdn}/lib.js?again"></script>', fetch_remote=True)
    assert out.count("window.lib=1") == 1 and rep["missing"] == [f"{cdn}/lib.js?again"]

    # Once the budget is spent, no further request is even opened.
    opened = []
    monkeypatch.setattr(ex._OPENER, "open", lambda *a, **k: opened.append(a) or (_ for _ in ()).throw(OSError("x")))
    res = ex._Resolver(ws, [ws], True)
    res.downloaded = ex.MAX_REMOTE_TOTAL
    assert res._fetch(f"{cdn}/lib.js?third") is None and opened == []


def test_remote_export_connects_to_the_address_it_checked(monkeypatch):
    # DNS rebinding: the name resolves to a public address when checked, to localhost when
    # connecting. The connection must use the checked address.
    answers = iter([[(2, 1, 6, "", ("93.184.216.34", 0))], [(2, 1, 6, "", ("127.0.0.1", 0))]])
    monkeypatch.setattr(ex.socket, "getaddrinfo", lambda *a, **k: next(answers))
    seen = []

    def connect(addr, *a, **k):
        seen.append(addr[0])
        raise OSError("stop here")
    monkeypatch.setattr(ex.socket, "create_connection", connect)
    res = ex._Resolver(Path("."), [], True)
    assert res._fetch("http://rebind.example/x.js") is None
    assert seen == ["93.184.216.34"]
