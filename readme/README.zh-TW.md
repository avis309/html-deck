<div align="center">

# HTML Deck

**自己動手修改 HTML 投影片、報告和網頁，不再燒 token。**

在瀏覽器裡直接改錯字、換顏色、移動區塊，不用找 AI。需要 agent 處理的修改，留下備註即可。

[![CI](https://github.com/avis309/html-deck/actions/workflows/ci.yml/badge.svg)](https://github.com/avis309/html-deck/actions/workflows/ci.yml)
[![PyPI](https://img.shields.io/pypi/v/htmldeck?label=pypi)](https://pypi.org/project/htmldeck/)
[![npm](https://img.shields.io/npm/v/@avis309/htmldeck?label=npm)](https://www.npmjs.com/package/@avis309/htmldeck)
[![Python 3.11+](https://img.shields.io/badge/python-3.11%2B-blue)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](../LICENSE)

[🇬🇧 English](../README.md) • [🇻🇳 Tiếng Việt](README.vi.md) • [🇨🇳 简体中文](README.zh-CN.md) • [🇹🇼 繁體中文](README.zh-TW.md)

<img src="https://raw.githubusercontent.com/avis309/html-deck/main/.github/assets/edit.png" alt="在 HTML Deck 中編輯投影片標題" width="900">

</div>

## 為什麼

Claude Code、Codex 這類 AI 助理很擅長用 HTML 製作投影片和網頁。修改卻是另一回事：就算只改一個字，
AI 也得重新讀一遍很大的檔案，既燒 token 又花時間，還可能動到你沒要求改的地方。

- **自己改。** 點一下就能修改文字、顏色、字型、圖片、版面和效果，不需要 agent。
- **告訴 agent 改哪裡。** 較大的修改，在區塊或區域上釘一則 **AI Feedback** 備註（「寫短一點」）。
  agent 就知道要改什麼、在哪裡改。
- **檔案保持乾淨。** 儲存時只更新你改過的部分，其餘內容維持原樣。若需要整份重寫，會先徵詢你的同意。
- **簡報。** 全螢幕放映，保留投影片內建的動畫。

<table>
  <tr>
    <td width="50%"><img src="https://raw.githubusercontent.com/avis309/html-deck/main/.github/assets/feedback.png" alt="AI Feedback 面板：一則區塊備註和一則區域備註"></td>
    <td width="50%"><img src="https://raw.githubusercontent.com/avis309/html-deck/main/.github/assets/present.png" alt="放映投影片"></td>
  </tr>
  <tr>
    <td align="center"><b>AI Feedback</b>：給 agent 的備註</td>
    <td align="center"><b>簡報</b>，保留投影片內建動畫</td>
  </tr>
  <tr>
    <td colspan="2"><img src="https://raw.githubusercontent.com/avis309/html-deck/main/.github/assets/svg.png" alt="在 SVG 架構圖中重新輸入標籤"></td>
  </tr>
  <tr>
    <td colspan="2" align="center"><b>圖表</b>：直接在圖中重新輸入標籤</td>
  </tr>
</table>

## 安裝

| 環境 | 指令 |
|---|---|
| Claude Code | `/plugin marketplace add avis309/html-deck`，然後 `/plugin install htmldeck@htmldeck` |
| Codex | `codex plugin marketplace add avis309/html-deck`，然後 `codex plugin add htmldeck@htmldeck` |
| uv | `uvx htmldeck` · `uv tool install htmldeck` |
| pipx / pip | `pipx install htmldeck` · `pip install htmldeck` |
| npm | `npx @avis309/htmldeck` · `npm i -g @avis309/htmldeck` |

需要 Python 3.11+（npm 版本另需 Node.js 18+）。支援 Linux、macOS 和 Windows。

## 使用

**搭配 Claude Code 或 Codex：**

1. 說「在 HTML Deck 中開啟我的投影片」（或在 Claude Code 中輸入 `/htmldeck:open [file]`）。
2. 能改的自己改，其餘的釘上 **AI Feedback** 備註。
3. 說「處理我的 HTML Deck 備註」。agent 會修改檔案並把備註標記為完成。HTML Deck 會在檔案變更後立即顯示新版本。

**單獨使用**，在存放檔案的資料夾中：

```bash
htmldeck                          # 以目前資料夾開啟編輯器
htmldeck --file <file>.html       # 先開啟該文件
htmldeck --root <folder> --port 6789 --no-browser
```

HTML Deck 在你的電腦上執行（`127.0.0.1`）。**儲存** 會在 `.htmldeck_bak/` 中為每個版本保留備份。
**儲存 ▾** 還能產生可分享的副本：一個內嵌圖片、樣式和字型的 HTML 檔，或一個 PDF。編輯器預設使用瀏覽器的
語言，可在語言選單中切換。

在本儲存庫的複本中試用：`htmldeck --root samples --file marketing-report.html`。

## 支援

| | |
|---|---|
| **文件** | 一般 HTML 頁面、報告，以及由 `.slide` 區塊組成的投影片，手寫或 agent 產生皆可。 |
| **Reveal.js** | 手寫的投影片：垂直堆疊、fragment、講者備忘稿、背景。Markdown 投影片為唯讀。 |
| **Tailwind CSS** | class 維持原樣；你的樣式疊加在上面。 |
| **SVG** | 重新輸入內嵌 `<svg>` 中的 `<text>` / `<tspan>` 標籤。 |
| **動畫** | 放映工作區中的檔案時，頁面自帶的指令碼（anime.js、GSAP…）會執行。編輯時 CSS 和 Web Animations 暫停，指令碼改動的內容會被鎖定。可在工具列加入 `data-fx` 進場效果。 |
| **安全** | 復原/重做、草稿復原、備份。編輯時會封鎖遠端指令碼（例如 CDN），直到你信任該檔案；簡報在獨立的 origin 上執行。 |

<details>
<summary><b>開發者詳情</b></summary>

**工作區。** 目前資料夾，或 `--root`。工作區之外的檔案不會被提供或寫入。位於工作區之外的 `--file`
會以其所在資料夾作為工作區（除非指定了 `--root`）。

**儲存。** 只修補你編輯過的原始碼位置；無法修補時，編輯器會先詢問再整份重寫。只有工作區中的檔案才有備份
（從電腦開啟的檔案沒有）。

**從電腦開啟**（或拖曳進來）而非來自工作區的檔案不會執行自身的指令碼，簡報時也一樣；HTML 匯出只儲存編輯後的
檔案，不內嵌圖片和樣式；AI Feedback 無法使用。

**匯出。** HTML 匯出會內嵌連結的圖片、樣式、指令碼和字型；無法取得的資源保留為連結。終端機指令：
`python -m htmldeck.export --file <file>.html --remote`（`--remote` 也會內嵌網路資源）。PDF 使用瀏覽器的列印對話框。

**AI Feedback。** 備註儲存在文件旁的 `.htmldeck_notes/<name>.json` 中。每則備註記錄元素的 selector、一段文字
和原始碼行號；區域備註還會記錄區域及其中的元素。

```bash
htmldeck-notes --file <file>.html             # 列出未完成的備註
htmldeck-notes --file <file>.html --prompt    # 產生可直接貼給 agent 的請求
htmldeck-notes --file <file>.html --done <id> # 將一則備註標記為完成
```

**開發。**

```bash
python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
npm install
npm run check        # eslint + pytest + browser specs
```

伺服器：`htmldeck/server.py`。編輯器：`htmldeck/web/js/`（原生 ES 模組，無打包工具；由 `app.mjs` 啟動；`npm run lint` 也會檢查匯入只往下層且不形成循環）。
瀏覽器測試：`tests/spec/`。發布：`python tools/bump_version.py X.Y.Z`，commit，打 tag `vX.Y.Z`，推送 tag。

</details>

## 授權

[MIT](../LICENSE) © Avis
