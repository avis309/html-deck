<div align="center">

# HTML Deck

**自己动手修改 HTML 幻灯片、报告和网页，不再烧 token。**

在浏览器里直接改错字、换颜色、移动区块，不用找 AI。需要 agent 处理的改动，留下备注即可。

[![CI](https://github.com/avis309/html-deck/actions/workflows/ci.yml/badge.svg)](https://github.com/avis309/html-deck/actions/workflows/ci.yml)
[![PyPI](https://img.shields.io/pypi/v/htmldeck?label=pypi)](https://pypi.org/project/htmldeck/)
[![npm](https://img.shields.io/npm/v/@avis309/htmldeck?label=npm)](https://www.npmjs.com/package/@avis309/htmldeck)
[![Python 3.11+](https://img.shields.io/badge/python-3.11%2B-blue)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](../LICENSE)

[🇬🇧 English](../README.md) • [🇻🇳 Tiếng Việt](README.vi.md) • [🇨🇳 简体中文](README.zh-CN.md) • [🇹🇼 繁體中文](README.zh-TW.md)

<img src="https://raw.githubusercontent.com/avis309/html-deck/main/.github/assets/edit.png" alt="在 HTML Deck 中编辑幻灯片标题" width="900">

</div>

## 为什么

Claude Code、Codex 这样的 AI 助手很擅长用 HTML 做幻灯片和网页。修改却是另一回事：哪怕只改一个字，
AI 也要重新读一遍很大的文件，既烧 token 又费时间，还可能动到你没要求改的地方。

- **自己改。** 点击即可修改文字、颜色、字体、图片、布局和动效，不需要 agent。
- **告诉 agent 改哪里。** 较大的改动，在区块或区域上钉一条 **AI Feedback** 备注（"写短一点"）。
  agent 就知道改什么、在哪里改。
- **文件保持干净。** 保存时只更新你改过的部分，其余内容原样保留。如需整体重写，会先征求你的同意。
- **演示。** 全屏放映，保留幻灯片自带的动画。

<table>
  <tr>
    <td width="50%"><img src="https://raw.githubusercontent.com/avis309/html-deck/main/.github/assets/feedback.png" alt="AI Feedback 面板：一条区块备注和一条区域备注"></td>
    <td width="50%"><img src="https://raw.githubusercontent.com/avis309/html-deck/main/.github/assets/present.png" alt="演示幻灯片"></td>
  </tr>
  <tr>
    <td align="center"><b>AI Feedback</b>：给 agent 的备注</td>
    <td align="center"><b>演示</b>，保留幻灯片自带动画</td>
  </tr>
  <tr>
    <td colspan="2"><img src="https://raw.githubusercontent.com/avis309/html-deck/main/.github/assets/svg.png" alt="在 SVG 架构图中重新输入标签"></td>
  </tr>
  <tr>
    <td colspan="2" align="center"><b>图表</b>：直接在图中重新输入标签</td>
  </tr>
</table>

## 安装

| 环境 | 命令 |
|---|---|
| Claude Code | `/plugin marketplace add avis309/html-deck`，然后 `/plugin install htmldeck@htmldeck` |
| Codex | `codex plugin marketplace add avis309/html-deck`，然后 `codex plugin add htmldeck@htmldeck` |
| uv | `uvx htmldeck` · `uv tool install htmldeck` |
| pipx / pip | `pipx install htmldeck` · `pip install htmldeck` |
| npm | `npx @avis309/htmldeck` · `npm i -g @avis309/htmldeck` |

需要 Python 3.11+（npm 版本还需要 Node.js 18+）。支持 Linux、macOS 和 Windows。

## 使用

**配合 Claude Code 或 Codex：**

1. 说 *"在 HTML Deck 中打开我的幻灯片"*（或在 Claude Code 中输入 `/htmldeck [file]`）。
2. 能改的自己改，其余的钉上 **AI Feedback** 备注。
3. 说 *"处理我的 HTML Deck 备注"*。agent 会修改文件并把备注标记为完成。在 HTML Deck 中重新加载文档即可看到。

**单独使用**，在存放文件的文件夹中：

```bash
htmldeck                          # 以当前文件夹打开编辑器
htmldeck --file <file>.html       # 先打开该文档
htmldeck --root <folder> --port 6789 --no-browser
```

HTML Deck 在你的电脑上运行（`127.0.0.1`）。**保存** 会在 `.htmldeck_bak/` 中为每个版本保留备份。
**保存 ▾** 还能生成可分享的副本：一个内嵌图片、样式和字体的 HTML 文件，或一个 PDF。编辑器默认使用浏览器
的语言，可在语言菜单中切换。

在本仓库的克隆中试用：`htmldeck --root samples --file marketing-report.html`。

## 支持

| | |
|---|---|
| **文档** | 普通 HTML 页面、报告，以及由 `.slide` 区块组成的幻灯片，手写或 agent 生成均可。 |
| **Reveal.js** | 手写的幻灯片：纵向堆叠、fragment、演讲者备注、背景。Markdown 幻灯片为只读。 |
| **Tailwind CSS** | class 保持原样；你的样式叠加在其上。 |
| **SVG** | 重新输入内嵌 `<svg>` 中的 `<text>` / `<tspan>` 标签。 |
| **动画** | 演示工作区中的文件时，页面自带的脚本（anime.js、GSAP…）会运行。编辑时 CSS 和 Web Animations 暂停，脚本改动的内容被锁定。可在工具栏添加 `data-fx` 入场效果。 |
| **安全** | 撤销/重做、草稿恢复、备份。编辑时会拦截远程脚本（例如 CDN），直到你信任该文件；演示在独立的 origin 上运行。 |

<details>
<summary><b>开发者详情</b></summary>

**工作区。** 当前文件夹，或 `--root`。工作区之外的文件不会被提供或写入。位于工作区之外的 `--file`
会以其所在文件夹作为工作区（除非指定了 `--root`）。

**保存。** 只修补你编辑过的源码位置；无法修补时，编辑器会先询问再整体重写。只有工作区中的文件才有备份
（从电脑打开的文件没有）。

**从电脑打开**（或拖入）而非来自工作区的文件不会运行自身脚本，演示时也一样；HTML 导出只保存编辑后的文件，
不内嵌图片和样式；AI Feedback 不可用。

**导出。** HTML 导出会内嵌链接的图片、样式、脚本和字体；无法获取的资源保留为链接。终端命令：
`python -m htmldeck.export --file <file>.html --remote`（`--remote` 还会内嵌网络资源）。PDF 使用浏览器的打印对话框。

**AI Feedback。** 备注保存在文档旁的 `.htmldeck_notes/<name>.json` 中。每条备注记录元素的 selector、一段文字
和源码行号；区域备注还记录区域及其中的元素。

```bash
htmldeck-notes --file <file>.html             # 列出未完成的备注
htmldeck-notes --file <file>.html --prompt    # 生成可直接粘贴给 agent 的请求
htmldeck-notes --file <file>.html --done <id> # 将一条备注标记为完成
```

**开发。**

```bash
python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
npm install
npm run check        # eslint + pytest + browser specs
```

服务器：`htmldeck/server.py`。编辑器：`htmldeck/web/js/`（原生 ES 模块，无打包器；由 `app.mjs` 启动；`npm run lint` 还会检查导入只向下层进行且不形成循环）。
浏览器测试：`tests/spec/`。发布：`python tools/bump_version.py X.Y.Z`，提交，打 tag `vX.Y.Z`，推送 tag。

</details>

## 许可证

[MIT](../LICENSE) © Avis
