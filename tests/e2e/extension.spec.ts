import { test, expect, chromium, type Page, type BrowserContext, type Worker } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FIXTURE_PATH = 'static.html';
const EXTENSION_PATH = path.resolve('dist');

/* ────────────────────────────────────────────────────────────────
 * Helpers
 * ──────────────────────────────────────────────────────────────── */

/** 启动加载了 dist/ 扩展的持久化上下文，并等待 MV3 service worker 就绪。 */
async function launchExtensionBrowser(): Promise<{
  context: BrowserContext;
  worker: Worker;
  cleanup: () => Promise<void>;
}> {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pagex-e2e-'));
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  return {
    context,
    worker,
    cleanup: async () => {
      await context.close();
      fs.rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

/** 打开 fixture 页面并等待内容脚本完成挂载。 */
async function openFixturePage(context: BrowserContext, baseURL: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${baseURL}/${FIXTURE_PATH}`);
  await expect(page.locator('pagex-root')).toBeAttached({ timeout: 15_000 });
  return page;
}

/** 确保页内 Agent 面板处于展开状态（刷新后面板可能保持收起）。 */
async function ensurePanelOpen(page: Page): Promise<void> {
  if (!(await page.getByLabel('任务').isVisible())) {
    await page.getByLabel('打开 PageX').click();
  }
  await expect(page.getByLabel('任务')).toBeVisible();
}

/** 在 fixture 页发射一次问候信号并断言输出。 */
async function transmitGreeting(page: Page, callsign: string, expected: string): Promise<void> {
  await page.locator('input[name="name"]').fill(callsign);
  await page.locator('#transmit').click();
  await expect(page.locator('#signal-out')).toHaveText(expected);
}

/* ────────────────────────────────────────────────────────────────
 * 用例
 * ──────────────────────────────────────────────────────────────── */

test.describe('构建产物完整性', () => {
  test('dist manifest 为 MV3 且带齐权限、内容脚本与后台脚本', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(EXTENSION_PATH, 'manifest.json'), 'utf8'),
    ) as {
      manifest_version: number;
      permissions?: string[];
      host_permissions?: string[];
      content_scripts?: Array<{ js?: string[] }>;
    };

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(
      expect.arrayContaining(['storage', 'unlimitedStorage', 'scripting', 'activeTab', 'debugger']),
    );
    expect(manifest.host_permissions).toEqual(expect.arrayContaining(['<all_urls>']));
    expect(manifest.content_scripts?.[0]?.js).toEqual(
      expect.arrayContaining(['content-scripts/content.js']),
    );

    expect(fs.existsSync(path.join(EXTENSION_PATH, 'content-scripts/content.js'))).toBe(true);
    expect(fs.existsSync(path.join(EXTENSION_PATH, 'background.js'))).toBe(true);
  });
});

test.describe('收起态 Composer 与屏幕标记', () => {
  test('空输入框保持收起高度，屏幕标记可进入并可取消', async ({ baseURL }) => {
    test.skip(!baseURL, '需要本地 fixture 服务');
    const { context, cleanup } = await launchExtensionBrowser();
    try {
      const page = await openFixturePage(context, baseURL!);
      await page.getByLabel('打开 PageX').click();

      const prompt = page.getByLabel('任务');
      await expect(prompt).toBeVisible();

      // 收起态：输入框本体 28px，composer 容器不超过 44px
      const promptBox = await prompt.boundingBox();
      const composerBox = await prompt.locator('..').locator('..').boundingBox();
      expect(promptBox?.height).toBe(28);
      expect(composerBox?.height).toBeLessThanOrEqual(44);

      // 进入屏幕标记，再取消回到 Prompt
      await page.getByLabel('添加内容').click();
      await page.getByRole('button', { name: '标记屏幕' }).click();
      await expect(page.getByLabel('屏幕标记画布')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByLabel('确认标记')).toBeEnabled();
      await page.getByLabel('取消标记').click();
      await expect(prompt).toBeVisible();
    } finally {
      await cleanup();
    }
  });
});

test.describe('页内 Agent 加载与会话持久化', () => {
  test('内容脚本挂载 pagex-root，多会话与设置面板跨刷新持久化', async ({ baseURL }) => {
    test.skip(!baseURL, '需要本地 fixture 服务');
    const { context, worker, cleanup } = await launchExtensionBrowser();
    try {
      // 后台 service worker 来自扩展自身
      expect(worker.url()).toContain('chrome-extension://');

      const page = await openFixturePage(context, baseURL!);
      const host = page.locator('pagex-root');

      // 初始收起态 + fixture 页自身交互
      await expect(page.getByLabel('打开 PageX')).toBeVisible();
      await expect(page.getByLabel('任务')).not.toBeVisible();
      await page.locator('#transmit').click();
      await expect(page.locator('#signal-out')).toHaveText(
        '信号收到，旅行者！灯塔已为你点亮。',
      );

      // 打开面板：默认会话 1，新建后为会话 2
      await page.getByLabel('打开 PageX').click();
      await expect(host).toContainText('会话 1');
      await page.getByLabel('新建标签页').click();
      await expect(host).toContainText('会话 2');

      // 刷新后仍停留在会话 2
      await page.waitForTimeout(200);
      await page.reload();
      await expect(page.locator('pagex-root')).toContainText('会话 2', { timeout: 15_000 });

      // 历史会话抽屉列出会话 1
      await ensurePanelOpen(page);
      await page.getByLabel('历史会话').click();
      await expect(host).toContainText('历史会话');
      await expect(host).toContainText('会话 1');
      await page.getByLabel('关闭历史').first().click();

      // 设置面板：模型与采集开关、服务商下拉含 DeepSeek
      await page.getByLabel('设置').click();
      await expect(host).toContainText('模型');
      await expect(host).toContainText('发送截图给模型');
      await expect(host).toContainText('采集网络请求和控制台日志');
      await page.getByLabel('服务商').click();
      await expect(page.getByRole('option', { name: 'DeepSeek' })).toBeVisible();
      await page.keyboard.press('Escape');

      // 5 个开关，触达面积不小于 36×20
      const switches = page.getByRole('switch');
      await expect(switches).toHaveCount(5);
      for (const item of await switches.all()) {
        const box = await item.boundingBox();
        expect(box).toBeTruthy();
        expect(box!.width).toBeGreaterThanOrEqual(36);
        expect(box!.height).toBeGreaterThanOrEqual(20);
      }

      // 最小化后面板收起，fixture 页交互不受影响
      await page.getByLabel('最小化', { exact: true }).click();
      await expect(page.getByLabel('打开 PageX')).toBeVisible();
      await expect(page.getByLabel('任务')).not.toBeVisible();
      await transmitGreeting(page, '织女四号', '信号收到，织女四号！灯塔已为你点亮。');
    } finally {
      await cleanup();
    }
  });
});

test.describe('示教流程与 Vault 命令', () => {
  test('录制跨刷新保持，总结确认后可固化为斜杠命令', async ({ baseURL }) => {
    test.skip(!baseURL, '需要本地 fixture 服务');
    const { context, cleanup } = await launchExtensionBrowser();
    try {
      const page = await openFixturePage(context, baseURL!);
      await page.getByLabel('打开 PageX').click();
      await page.getByLabel('添加内容').click();
      await page.getByRole('button', { name: '开始示教' }).click();

      // 录制阶段：示教控制球出现，页面上做一次输入 + 一次点击
      await expect(page.getByLabel('打开示教控制')).toBeVisible();
      await transmitGreeting(page, '织女四号', '信号收到，织女四号！灯塔已为你点亮。');

      // 刷新后录制状态保持
      await page.reload();
      await expect(page.getByLabel('打开示教控制')).toBeVisible({ timeout: 15_000 });

      // 结束并总结 → 示教流程确认卡片
      await page.getByLabel('打开示教控制').click();
      await page.getByRole('button', { name: '结束并总结' }).click();
      await expect(page.getByLabel('示教流程确认')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(/条记录/)).toBeVisible();

      // 用 Prompt 提出修改要求，卡片展示调整结果
      const prompt = page.getByLabel('任务');
      await prompt.fill('把流程名称改得更简短');
      await prompt.press('Enter');
      await expect(page.getByText(/已调整/)).toBeVisible({ timeout: 15_000 });

      // 确认并固化 → 成功提示出现后又消失（5s 自动收起）
      await page.getByRole('button', { name: '确认并固化' }).click();
      const savedAlert = page.getByText(/已固化到当前网站 Vault/);
      await expect(savedAlert).toBeVisible();
      await expect(savedAlert).not.toBeVisible({ timeout: 7_000 });

      // 输入 / 打开命令列表，选中后 Prompt 清空并出现移除命令按钮
      await prompt.fill('/');
      const commandRow = page.getByRole('button', { name: /操作流程/ }).first();
      await expect(commandRow).toBeVisible();
      await commandRow.click();
      await expect(prompt).toHaveValue('');
      await expect(page.getByLabel(/移除命令/)).toBeVisible();
    } finally {
      await cleanup();
    }
  });
});
