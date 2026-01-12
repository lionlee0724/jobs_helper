const { chromium } = require('playwright');
const fs = require('fs');

async function main() {
  try {
    // Read the Universal_Job_Helper.js content
    const scriptContent = fs.readFileSync('Universal_Job_Helper.js', 'utf8');

    // Launch Chromium browser in headless mode
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
page.on('console', msg => console.log('PAGE LOG:', msg.text()));
page.on('pageerror', exception => console.log(`PAGE ERROR: "${exception}"`));

    // Navigate to the page
    await page.goto('https://www.liepin.com/zhaopin/');

    // Inject mock GM environment
    await page.addScriptTag({
      content: `
        window.GM_getValue = (key, defaultValue) => defaultValue;
        window.GM_setValue = () => {};
        window.GM_registerMenuCommand = () => {};
        window.GM_xmlhttpRequest = () => {};
        window.GM_openInTab = () => {};
      `
    });

    // Inject the Universal_Job_Helper.js content
    await page.addScriptTag({ content: scriptContent });

    // Wait for #ujh-panel to appear with 10s timeout
    await page.waitForSelector('#ujh-panel', { timeout: 10000 });

    console.log('SUCCESS: Panel found');
    process.exit(0);
  } catch (error) {
    console.log('ERROR: Panel not found');
    process.exit(1);
  } finally {
    if (browser) await browser.close();
  }
}

main();
