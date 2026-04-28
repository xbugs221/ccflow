/**
 * 实测 thinking mode 是否生效
 * 自动打开 ccflow UI，切换思考深度，发送消息，检查 jsonl
 */
import { chromium } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost:4001';
const PROJECT_DIR = path.join(process.cwd(), '.ccflow');

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function waitForJsonl(sessionId, timeout = 30000) {
  const jsonlPath = path.join(PROJECT_DIR, `${sessionId}.jsonl`);
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fs.existsSync(jsonlPath)) {
      return jsonlPath;
    }
    await sleep(500);
  }
  return null;
}

async function main() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  try {
    // 打开首页，点击 ccflow 项目
    console.log('Opening home page...');
    await page.goto(`${BASE_URL}/`);
    await sleep(3000);

    // 截图看当前状态
    await page.screenshot({ path: '/tmp/test-thinking-step1.png' });
    console.log('Step 1 screenshot saved');

    // 点击 ccflow 项目卡片
    console.log('Clicking ccflow project...');
    const ccflowCard = await page.locator('text=ccflow').first();
    if (await ccflowCard.isVisible().catch(() => false)) {
      await ccflowCard.click();
      console.log('Clicked ccflow');
      await sleep(2000);
    }

    await page.screenshot({ path: '/tmp/test-thinking-step2.png' });
    console.log('Step 2 screenshot saved');

    // 找 "New Session" 按钮
    console.log('Looking for New Session button...');
    const newSessionBtn = await page.locator('button:has-text("New Session")').first();
    if (await newSessionBtn.isVisible().catch(() => false)) {
      await newSessionBtn.click();
      console.log('Clicked New Session');
      await sleep(2000);
    } else {
      // 尝试直接访问新会话 URL
      console.log('New Session button not found, trying direct URL');
      await page.goto(`${BASE_URL}${process.cwd()}/c9999`);
      await sleep(2000);
    }

    await page.screenshot({ path: '/tmp/test-thinking-step2.png' });
    console.log('Step 2 screenshot saved');

    // 等待 textarea 出现
    console.log('Waiting for textarea...');
    const textarea = await page.locator('textarea').first();
    await textarea.waitFor({ state: 'visible', timeout: 10000 });
    console.log('Textarea found');

    // 找 provider 切换 - 看当前是什么 provider
    const providerText = await page.locator('[data-testid="provider-badge"], .provider-badge, button:has-text("Claude"), button:has-text("Codex")').first().textContent().catch(() => 'unknown');
    console.log('Current provider:', providerText);

    // 如果需要切换到 Claude
    if (!providerText.includes('Claude')) {
      const providerBtn = await page.locator('button:has-text("Codex"), button:has-text("claude")').first();
      if (await providerBtn.isVisible().catch(() => false)) {
        await providerBtn.click();
        await sleep(500);
        const claudeOpt = await page.locator('text=Claude').first();
        if (await claudeOpt.isVisible().catch(() => false)) {
          await claudeOpt.click();
          console.log('Switched to Claude');
          await sleep(1000);
        }
      }
    }

    // 找思考模式按钮
    console.log('Looking for thinking mode button...');
    await page.screenshot({ path: '/tmp/test-thinking-step3.png' });

    // 获取所有按钮的 title
    const buttons = await page.locator('button').all();
    let thinkingBtn = null;
    for (const btn of buttons) {
      const title = await btn.getAttribute('title').catch(() => '');
      if (title && (title.toLowerCase().includes('thinking') || title.includes('思考'))) {
        thinkingBtn = btn;
        console.log('Found thinking button with title:', title);
        break;
      }
    }

    if (thinkingBtn) {
      await thinkingBtn.click();
      await sleep(500);

      // 选择 medium
      const mediumOpt = await page.locator('text=Medium, [data-mode="medium"]').first();
      if (await mediumOpt.isVisible().catch(() => false)) {
        await mediumOpt.click();
        console.log('Selected MEDIUM thinking mode');
      } else {
        // 尝试其他选择器
        const opts = await page.locator('button, div[role="option"]').all();
        for (const opt of opts) {
          const text = await opt.textContent().catch(() => '');
          if (text && text.toLowerCase().includes('medium')) {
            await opt.click();
            console.log('Selected MEDIUM via text match');
            break;
          }
        }
      }
      await sleep(500);
    } else {
      console.log('WARNING: Thinking mode button not found!');
    }

    // 输入并发送消息
    console.log('Sending message with MEDIUM thinking mode...');
    await textarea.fill('Say exactly "test-medium" and nothing else.');
    await sleep(500);
    await textarea.press('Enter');
    console.log('Message sent, waiting for response...');

    // 等待响应完成 (15秒)
    await sleep(15000);

    // 获取当前 URL 和会话信息
    const url = page.url();
    console.log('Current URL:', url);

    // 从 conf.json 获取最新会话
    const conf = JSON.parse(fs.readFileSync(path.join(PROJECT_DIR, 'conf.json'), 'utf8'));
    const chatEntries = Object.entries(conf.chat || {});
    const latestEntry = chatEntries[chatEntries.length - 1];
    const sessionId = latestEntry ? latestEntry[1].sessionId : null;
    console.log('Latest session ID from conf:', sessionId);

    // 检查 jsonl
    if (sessionId) {
      const jsonlPath = await waitForJsonl(sessionId, 20000);
      if (jsonlPath) {
        console.log('\n=== JSONL FOUND ===');
        console.log('Path:', jsonlPath);
        const content = fs.readFileSync(jsonlPath, 'utf8');
        const lines = content.trim().split('\n');
        console.log('Total lines:', lines.length);

        // 查找 effort 相关字段
        let foundEffort = false;
        for (let i = 0; i < lines.length; i++) {
          try {
            const obj = JSON.parse(lines[i]);
            if (obj.effort !== undefined || obj.thinking !== undefined || obj.thinkingMode !== undefined) {
              foundEffort = true;
              console.log(`\nLine ${i+1} has effort/thinking:`);
              console.log('  effort:', obj.effort);
              console.log('  thinking:', JSON.stringify(obj.thinking));
              console.log('  thinkingMode:', obj.thinkingMode);
            }
            if (obj.options && (obj.options.effort !== undefined || obj.options.thinkingMode !== undefined)) {
              foundEffort = true;
              console.log(`\nLine ${i+1} options has effort:`);
              console.log('  options.effort:', obj.options.effort);
              console.log('  options.thinkingMode:', obj.options.thinkingMode);
            }
          } catch {}
        }

        if (!foundEffort) {
          console.log('\nNo effort/thinking fields found in jsonl!');
          console.log('First line keys:', Object.keys(JSON.parse(lines[0])).join(', '));
        }
      } else {
        console.log('No jsonl file found for session:', sessionId);
      }
    }

    // 测试 HIGH 模式
    console.log('\n--- Now testing HIGH mode ---');
    const thinkingBtn2 = await page.locator('button[title*="thinking"], button[title*="思考"]').first();
    if (await thinkingBtn2.isVisible().catch(() => false)) {
      await thinkingBtn2.click();
      await sleep(500);
      const highOpt = await page.locator('text=High').first();
      if (await highOpt.isVisible().catch(() => false)) {
        await highOpt.click();
        console.log('Selected HIGH thinking mode');
      }
      await sleep(500);
    }

    await textarea.fill('Say exactly "test-high" and nothing else.');
    await sleep(500);
    await textarea.press('Enter');
    console.log('Message sent with HIGH, waiting...');
    await sleep(15000);

    // 再次检查 jsonl
    if (sessionId) {
      const jsonlPath = path.join(PROJECT_DIR, `${sessionId}.jsonl`);
      if (fs.existsSync(jsonlPath)) {
        const content = fs.readFileSync(jsonlPath, 'utf8');
        const lines = content.trim().split('\n');
        console.log('\n=== After HIGH - Total lines:', lines.length);

        for (let i = 0; i < lines.length; i++) {
          try {
            const obj = JSON.parse(lines[i]);
            if (obj.effort !== undefined || (obj.options && obj.options.effort !== undefined)) {
              const eff = obj.effort !== undefined ? obj.effort : obj.options.effort;
              console.log(`Line ${i+1}: effort = ${eff}`);
            }
          } catch {}
        }
      }
    }

    console.log('\n=== TEST COMPLETE ===');

  } catch (error) {
    console.error('Error:', error);
    await page.screenshot({ path: '/tmp/test-thinking-error.png' });
    console.log('Error screenshot saved to /tmp/test-thinking-error.png');
  } finally {
    await browser.close();
  }
}

main();
