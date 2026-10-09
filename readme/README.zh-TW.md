<div align="center">

<h1><img src="../htmldeck/web/assets/logo.svg" width="48" height="48" align="absmiddle" alt=""> HTML Deck</h1>

**為 AI 產生的 HTML 投影片、報告和網頁打造的視覺化編輯器。**

在瀏覽器裡所見即所得地直接修改；或者用 **AI Feedback** 標出所有要改的地方，讓 agent 一次全部改好。

[![CI](https://github.com/avis309/html-deck/actions/workflows/ci.yml/badge.svg)](https://github.com/avis309/html-deck/actions/workflows/ci.yml)
[![PyPI](https://img.shields.io/pypi/v/htmldeck?label=pypi)](https://pypi.org/project/htmldeck/)
[![npm](https://img.shields.io/npm/v/@avis309/htmldeck?label=npm)](https://www.npmjs.com/package/@avis309/htmldeck)
[![Python 3.11+](https://img.shields.io/badge/python-3.11%2B-blue)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](../LICENSE)

[🇬🇧 English](../README.md) • [🇻🇳 Tiếng Việt](README.vi.md) • [🇨🇳 中文](README.zh-CN.md) • [🇹🇼 繁體中文](README.zh-TW.md)

<img src="https://raw.githubusercontent.com/avis309/html-deck/main/.github/assets/edit.png" alt="在 HTML Deck 中編輯投影片標題" width="900">

</div>

## 為什麼

Claude Code、Codex 這類 AI 助理很擅長用 HTML 製作投影片和網頁。修改卻是另一回事：就算只改一個字，
AI 也得重新讀一遍很大的檔案，既燒 token 又花時間，還可能動到你沒要求改的地方。

- **所見即所得。** 直接在頁面上點擊，修改文字、顏色、字型、圖片、版面和效果。小修改幾秒完成，不耗 token。
- **批次 AI Feedback。** 選取一個區塊或框選一片區域，寫下要改什麼（「寫短一點」）。所有要改的地方都標好後，
  把整份清單一次交給 agent：它清楚知道要改什麼、在哪裡改。
- **檔案保持乾淨。** 儲存時只更新你改過的部分，其餘內容維持原樣。若需要整份重寫，會先徵詢你的同意。
- **簡報。** 全螢幕放映，保留投影片內建的動畫。

<table>
  <tr>
    <td width="50%"><img src="https://raw.githubusercontent.com/avis309/html-deck/main/.github/assets/feedback.png" alt="AI Feedback 面板：一則區塊備註和一則區域備註"></td>
    <td width="50%"><img src="https://raw.githubusercontent.com/avis309/html-deck/main/.github/assets/present.png" alt="放映投影片"></td>
  </tr>
  <tr>
    <td align="center"><b>AI Feedback</b>：所有修改，一份清單交給 agent</td>
    <td align="center"><b>簡報</b>，保留投影片內建動畫</td>
  </tr>
  <tr>
    <td width="50%"><img src="https://raw.githubusercontent.com/avis309/html-deck/main/.github/assets/effects.png" alt="依類別排列動畫的側邊欄"></td>
    <td width="50%"><img src="https://raw.githubusercontent.com/avis309/html-deck/main/.github/assets/svg.png" alt="在 SVG 架構圖中重新輸入標籤"></td>
  </tr>
  <tr>
    <td align="center"><b>動畫</b>：在側邊欄挑選，或一鍵為整頁加入</td>
    <td align="center"><b>圖表</b>：直接在圖中重新輸入標籤</td>
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
2. 直接修改，或在所有想讓 agent 改的地方留下 **AI Feedback**。
3. 說「處理我的 HTML Deck 備註」。agent 會修改檔案並把備註標記為完成。HTML Deck 會在檔案變更後立即顯示新版本。

**單獨使用**，在存放檔案的資料夾中：

```bash
htmldeck                          # 以目前資料夾開啟編輯器
htmldeck --file <file>.html       # 先開啟該文件
htmldeck --root <folder> --port 6789 --no-browser
```

HTML Deck 在你的電腦上執行（`127.0.0.1`），透過它印出的連結開啟：連結帶有本次執行的金鑰，電腦上的其他程式無法使用編輯器。**儲存** 會在 `.htmldeck_bak/` 中為每個版本保留備份。
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
| **動畫** | 放映工作區中的檔案時，頁面自帶的指令碼（anime.js、GSAP…）會執行。編輯時 CSS 和 Web Animations 暫停，指令碼改動的內容會被鎖定。無需程式碼即可在工具列加入動畫：進入（上升、平移、擦除、模糊、縮放、基線上升、翻滾、閃爍、剪貼）、強調（彈出、衝擊）、資料與圖表（count-up、長條增長、描線）和循環（旋轉、明滅、脈動、搖擺、漂浮）。**為這張投影片加入動畫**一步為整張投影片加入，可復原；**為檔案啟用 FX** 讓單獨開啟檔案時也能執行。 |
| **安全** | 復原/重做、草稿復原、備份。在你信任工作區之前，編輯時不執行工作區自帶的指令碼（只問一次並記住；`--trust` 僅本次工作階段），遠端指令碼（CDN）還需信任該檔案。簡報在獨立的 origin 上完整執行。備份和備註不跟隨符號連結；匯出 HTML 只嵌入網頁資源，且不從本機或內網位址下載。 |

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
