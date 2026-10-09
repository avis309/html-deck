import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { I18N, LAYER_NAMES, storedLang, translateToastFor } from '../../htmldeck/web/js/i18n.mjs';

assert.deepEqual(Object.keys(I18N['zh-Hant']).sort(), Object.keys(I18N.zh).sort());
assert.deepEqual(Object.keys(LAYER_NAMES['zh-Hant']).sort(), Object.keys(LAYER_NAMES.zh).sort());
assert.equal(translateToastFor('zh-Hant', 'Link removed'), '連結已移除');
assert.equal(translateToastFor('zh-Hant', 'Save failed: HTML Deck is not running — start it again, then reload this page'), '儲存失敗: HTML Deck 未在執行 — 請重新啟動 HTML Deck，然後重新整理此頁面');
for (const [locale, expected] of [['zh-TW', 'zh-Hant'], ['zh-HK', 'zh-Hant'], ['zh-MO', 'zh-Hant'], ['zh-Hant-TW', 'zh-Hant'], ['zh-CN', 'zh'], ['zh-Hans', 'zh'], ['vi-VN', 'vi'], ['fr-FR', 'en']]) {
  Object.defineProperty(globalThis, 'navigator', { value: { languages: [locale] }, configurable: true });
  assert.equal(storedLang(), expected);
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'htmldeck-hant-'));
fs.copyFileSync('tests/fixtures/deck.html', path.join(root, 'deck.html'));
// Same choice as characterization.spec.mjs: the PYTHON variable (CI), else .venv, else python3.
const py = process.env.PYTHON || (fs.existsSync('.venv/bin/python') ? '.venv/bin/python' : 'python3');
const proc = spawn(py, ['-u', '-m', 'htmldeck', '--root', root, '--no-browser', '--port', '0', '--trust'], { env: { ...process.env, HTMLDECK_CONFIG_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'htmldeck-config-')) } });
proc.on('error', e => { console.error(`cannot start ${py}: ${e.message}`); process.exit(1); });
let browser;
try {
  const url = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(output || 'Server startup timed out')), 15000);
    proc.stdout.on('data', data => {
      output += data;
      const match = output.match(/Editor URL\s*:\s*(http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    });
    proc.stderr.on('data', data => { output += data; });
    proc.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${output}`)); });
  });
  browser = await chromium.launch({ headless: true });
  for (const locale of ['zh-TW', 'zh-HK', 'zh-Hant']) {
    const context = await browser.newContext({ locale, viewport: { width: 1440, height: 900 } });
    // Exercise the offline fallback: Google web fonts are unavailable.
    await context.route(/fonts\.(googleapis|gstatic)\.com/, route => route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${url}&file=deck.html`);   // the printed link (with its session key)
    await page.waitForFunction(() => document.body.dataset.docState === 'ready');
    assert.equal(await page.getAttribute('html', 'lang'), 'zh-Hant');
    assert.equal((await page.locator('#btn-save').textContent()).trim(), '儲存');
    assert.equal(await page.locator('#lang-indicator').textContent(), '繁');
    assert.match(await page.locator('#btn-save').evaluate(el => getComputedStyle(el).fontFamily), /Noto Sans TC.*PingFang TC.*Microsoft JhengHei/);
    await page.click('#btn-lang');
    const option = page.locator('[data-lang="zh-Hant"]');
    assert.match(await option.textContent(), /繁體中文/);
    assert.match(await option.getAttribute('class'), /active/);
    const cdp = await context.newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root: dom } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: dom.nodeId, selector: '[data-lang="zh-Hant"] .name' });
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    assert.ok(fonts.some(font => font.glyphCount >= 4 && !/LastResort/i.test(font.familyName)), JSON.stringify(fonts));
    console.log(`${locale}: offline glyph rendering`, fonts);
    for (const width of [1440, 1024, 768]) {
      await page.setViewportSize({ width, height: 900 });
      const box = await option.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width && box.y + box.height <= 900);
      assert.ok(await option.evaluate(el => el.scrollWidth <= el.clientWidth));
      for (const selector of ['#btn-save', '#btn-present', '#sb-find', '#page-count']) {
        const control = page.locator(selector);
        const bounds = await control.boundingBox();
        assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width, `${selector} outside ${width}px viewport`);
        assert.ok(await control.evaluate(el => el.scrollHeight <= el.clientHeight), `${selector} text wraps or clips`);
      }
      await page.screenshot({ path: path.join(root, `${locale}-${width}.png`) });
    }
    await page.click('[data-lang="zh"]');
    assert.equal(await page.getAttribute('html', 'lang'), 'zh-CN');
    // Simplified Chinese keeps its own glyph forms: no Traditional fonts in its stack.
    assert.doesNotMatch(await page.locator('#btn-save').evaluate(el => getComputedStyle(el).fontFamily), /Noto Sans TC|PingFang TC/);
    await page.click('#btn-lang');
    await page.click('[data-lang="zh-Hant"]');
    assert.equal(await page.locator('#toast').textContent(), '已切換為繁體中文');
    await page.reload();
    await page.waitForFunction(() => document.body.dataset.docState === 'ready');
    assert.equal(await page.getAttribute('html', 'lang'), 'zh-Hant');
    assert.equal(await page.evaluate(() => localStorage.getItem('gs9_editor_lang')), 'zh-Hant');
    await page.click('#sb-help');
    const heading = page.locator('[data-i18n="shortcuts_h"]');
    assert.ok(await heading.isVisible());
    assert.equal(await heading.textContent(), I18N['zh-Hant'].shortcuts_h);
    assert.match(await heading.evaluate(el => getComputedStyle(el).fontFamily), /Noto Sans TC.*PingFang TC/);
    await page.screenshot({ path: path.join(root, `${locale}-shortcuts.png`) });
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log(`Traditional Chinese checks passed. Screenshots: ${root}`);
} finally {
  if (browser) await browser.close();
  proc.kill();
}
