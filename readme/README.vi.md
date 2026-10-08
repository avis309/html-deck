<div align="center">

# HTML Deck

**Editor trực quan cho slide, báo cáo và trang HTML do AI làm ra.**

Thấy gì sửa nấy, ngay trên trình duyệt. Hoặc đánh dấu mọi chỗ cần sửa bằng **AI Feedback** rồi để
agent sửa hết trong một lượt.

[![CI](https://github.com/avis309/html-deck/actions/workflows/ci.yml/badge.svg)](https://github.com/avis309/html-deck/actions/workflows/ci.yml)
[![PyPI](https://img.shields.io/pypi/v/htmldeck?label=pypi)](https://pypi.org/project/htmldeck/)
[![npm](https://img.shields.io/npm/v/@avis309/htmldeck?label=npm)](https://www.npmjs.com/package/@avis309/htmldeck)
[![Python 3.11+](https://img.shields.io/badge/python-3.11%2B-blue)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](../LICENSE)

[🇬🇧 English](../README.md) • [🇻🇳 Tiếng Việt](README.vi.md) • [🇨🇳 简体中文](README.zh-CN.md) • [🇹🇼 繁體中文](README.zh-TW.md)

<img src="https://raw.githubusercontent.com/avis309/html-deck/main/.github/assets/edit.png" alt="Sửa tiêu đề slide trong HTML Deck" width="900">

</div>

## Vì sao cần tool này

Các trợ lý AI như Claude Code và Codex làm slide và trang HTML rất giỏi. Sửa lại thì khác: chỉ
đổi một chữ cũng khiến AI phải đọc lại cả một file lớn, tốn token và thời gian, và có thể đụng vào
những chỗ bạn không yêu cầu.

- **Thấy gì sửa nấy.** Bấm thẳng lên trang để đổi chữ, màu, font, ảnh, bố cục và hiệu ứng
  (WYSIWYG). Sửa nhỏ chỉ mất vài giây, không tốn token.
- **AI Feedback hàng loạt.** Chọn một khối hoặc quét cả một vùng rồi ghi điều cần đổi ("viết ngắn
  lại"). Làm vậy ở mọi chỗ cần sửa, rồi giao cả danh sách cho agent một lần: agent biết chính xác
  sửa gì, ở đâu.
- **File vẫn sạch.** Khi lưu, chỉ phần bạn sửa được cập nhật, phần còn lại giữ nguyên. Nếu cần
  viết lại cả file, editor sẽ hỏi bạn trước.
- **Thuyết trình.** Trình chiếu toàn màn hình với hiệu ứng sẵn có của deck.

<table>
  <tr>
    <td width="50%"><img src="https://raw.githubusercontent.com/avis309/html-deck/main/.github/assets/feedback.png" alt="Bảng AI Feedback với một ghi chú cho khối và một ghi chú cho vùng"></td>
    <td width="50%"><img src="https://raw.githubusercontent.com/avis309/html-deck/main/.github/assets/present.png" alt="Trình chiếu một deck"></td>
  </tr>
  <tr>
    <td align="center"><b>AI Feedback</b>: mọi chỗ cần sửa, một danh sách cho agent</td>
    <td align="center"><b>Thuyết trình</b> với hiệu ứng của deck</td>
  </tr>
  <tr>
    <td colspan="2"><img src="https://raw.githubusercontent.com/avis309/html-deck/main/.github/assets/svg.png" alt="Gõ lại nhãn trong sơ đồ kiến trúc SVG"></td>
  </tr>
  <tr>
    <td colspan="2" align="center"><b>Sơ đồ</b>: gõ lại nhãn ngay trong sơ đồ</td>
  </tr>
</table>

## Cách Cài đặt

| Ở đâu | Lệnh |
|---|---|
| Claude Code | `/plugin marketplace add avis309/html-deck` rồi `/plugin install htmldeck@htmldeck` |
| Codex | `codex plugin marketplace add avis309/html-deck` rồi `codex plugin add htmldeck@htmldeck` |
| uv | `uvx htmldeck` · `uv tool install htmldeck` |
| pipx / pip | `pipx install htmldeck` · `pip install htmldeck` |
| npm | `npx @avis309/htmldeck` · `npm i -g @avis309/htmldeck` |

Cần Python 3.11+ (bản npm cần thêm Node.js 18+). Chạy trên Linux, macOS và Windows.

## Sử dụng

**Với Claude Code hoặc Codex:**

1. Nói *"mở deck của tôi trong HTML Deck"* (hoặc gõ `/htmldeck:open [file]` trong Claude Code).
2. Sửa trực tiếp, hoặc để lại **AI Feedback** ở mọi chỗ bạn muốn agent sửa.
3. Nói *"áp dụng các ghi chú HTML Deck của tôi"*. Agent sửa file và đánh dấu ghi chú đã xong.
   HTML Deck hiện bản mới ngay khi file thay đổi.

**Dùng riêng**, trong thư mục chứa file của bạn:

```bash
htmldeck                          # mở editor cho thư mục hiện tại
htmldeck --file <file>.html       # mở tài liệu đó trước
htmldeck --root <folder> --port 6789 --no-browser
```

HTML Deck chạy trên máy của bạn (`127.0.0.1`). **Lưu** giữ một bản sao lưu cho mỗi phiên bản trong
`.htmldeck_bak/`. **Lưu ▾** còn cho bạn một bản để chia sẻ: một file HTML đã gói sẵn ảnh, style và
font, hoặc một file PDF. Editor mở theo ngôn ngữ của trình duyệt; đổi ngôn ngữ trong menu ngôn ngữ.

Thử ngay trong bản clone của repo này: `htmldeck --root samples --file marketing-report.html`.

## Hỗ trợ

| | |
|---|---|
| **Tài liệu** | Trang HTML, báo cáo và deck gồm các khối `.slide`, do bạn hay agent viết. |
| **Reveal.js** | Deck viết tay: stack, fragment, speaker notes, background. Slide Markdown chỉ đọc. |
| **Tailwind CSS** | Class giữ nguyên như đã viết; style của bạn được áp lên trên. |
| **SVG** | Gõ lại nhãn `<text>` / `<tspan>` trong một `<svg>` nằm trong trang. |
| **Hiệu ứng** | Script riêng của trang (anime.js, GSAP…) chạy khi thuyết trình một file trong workspace. Khi sửa, CSS và Web Animations tạm dừng, nội dung do script thay đổi bị khoá. Thêm hiệu ứng xuất hiện `data-fx` từ thanh công cụ. |
| **An toàn** | Hoàn tác/làm lại, khôi phục bản nháp, sao lưu. Script từ xa (ví dụ CDN) bị chặn khi sửa cho đến khi bạn tin tưởng file; thuyết trình chạy trên một origin riêng. |

<details>
<summary><b>Chi tiết cho developer</b></summary>

**Workspace.** Thư mục hiện tại, hoặc `--root`. Không có gì bên ngoài được phục vụ hay ghi. Một
`--file` nằm ngoài sẽ lấy thư mục của nó làm workspace (trừ khi có `--root`).

**Lưu.** Mã nguồn được vá đúng chỗ bạn sửa; khi không vá được, editor hỏi trước khi viết lại. Bản
sao lưu chỉ có với file trong workspace (không có với file mở từ máy tính).

**File mở từ máy tính** (hoặc kéo thả vào) thay vì từ workspace sẽ không chạy script của nó, kể cả
khi thuyết trình; xuất HTML lưu file đã sửa mà không gói ảnh và style; AI Feedback bị tắt.

**Xuất file.** Xuất HTML gói ảnh, style, script và font được liên kết; tài nguyên không tải được
giữ nguyên dạng link. Từ terminal: `python -m htmldeck.export --file <file>.html --remote`
(`--remote` gói cả tài nguyên trên web). PDF dùng hộp thoại in của trình duyệt.

**AI Feedback.** Ghi chú lưu trong `.htmldeck_notes/<name>.json` cạnh tài liệu. Mỗi ghi chú ghi lại
selector của phần tử, một đoạn chữ và số dòng trong file; ghi chú vùng còn ghi lại vùng đó và các
phần tử bên trong.

```bash
htmldeck-notes --file <file>.html             # liệt kê ghi chú chưa xong
htmldeck-notes --file <file>.html --prompt    # dạng yêu cầu sẵn để dán cho agent
htmldeck-notes --file <file>.html --done <id> # đánh dấu một ghi chú đã xong
```

**Phát triển.**

```bash
python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
npm install
npm run check        # eslint + pytest + browser specs
```

Server: `htmldeck/server.py`. Editor: `htmldeck/web/js/` (ES module thuần, không bundler; `app.mjs`
khởi động editor; `npm run lint` còn kiểm tra import chỉ đi xuống các tầng và không tạo vòng). Browser spec: `tests/spec/`. Phát hành: `python tools/bump_version.py X.Y.Z`,
commit, tag `vX.Y.Z`, push tag.

</details>

## Giấy phép

[MIT](../LICENSE) © Avis
