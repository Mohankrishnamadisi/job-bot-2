const { chromium } = require('playwright');
const {
  playwrightHeadless,
  playwrightLaunchTimeout,
  playwrightPageTimeout,
  playwrightLaunchRetries,
  playwrightLaunchRetryDelay,
} = require('../config/env');
const logger = require('../utils/logger');

let browserInstance = null;

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function retry(fn, attempts, delayMs) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      logger.warn(`Playwright launch attempt ${attempt} failed: ${error.message}`);
      if (attempt < attempts) {
        await delay(delayMs);
      }
    }
  }

  throw lastError;
}

async function connectBrowser() {
  if (browserInstance && browserInstance.isConnected && browserInstance.isConnected()) {
    return browserInstance;
  }

  browserInstance = await retry(
    () =>
      chromium.launch({
        headless: playwrightHeadless,
        timeout: playwrightLaunchTimeout,
        args: ['--disable-http2'],
      }),
    playwrightLaunchRetries,
    playwrightLaunchRetryDelay
  );

  return browserInstance;
}

async function newPage() {
  const browser = await connectBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(playwrightPageTimeout);
  page.setDefaultNavigationTimeout(playwrightPageTimeout);

  const originalClose = page.close.bind(page);
  page.close = async () => {
    await originalClose().catch(() => {});
    await context.close().catch(() => {});
  };

  return page;
}

async function launchPage(url, options = {}) {
  const page = await newPage();

  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: playwrightPageTimeout,
      ...options,
    });
    return page;
  } catch (error) {
    await page.close().catch(() => {});
    logger.error(`Playwright page navigation failed for ${url}: ${error.message}`);
    throw error;
  }
}

async function closeBrowser() {
  if (!browserInstance) {
    return;
  }

  try {
    await browserInstance.close();
  } catch (error) {
    logger.warn(`Error closing Playwright browser: ${error.message}`);
  } finally {
    browserInstance = null;
  }
}

process.on('exit', () => {
  closeBrowser().catch(() => {});
});
process.on('SIGINT', async () => {
  await closeBrowser();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await closeBrowser();
  process.exit(0);
});

module.exports = {
  newPage,
  launchPage,
  closeBrowser,
};
