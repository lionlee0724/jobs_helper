const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function main() {
  const browser = await chromium.launch({ headless: false }); // Headless false to see what happens
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('Navigating to BOSS Zhipin (Public Job List)...');
  // Using a public search URL to verify selectors without login if possible
  // Using a generic search to ensure results
  await page.goto('https://www.zhipin.com/web/geek/job?query=前端&city=101020100', { timeout: 60000 });

  console.log('Injecting Universal_Job_Helper.js for selector verification...');
  
  // Define selectors to check based on Universal_Job_Helper.js SELECTORS.BOSS
  const selectors = {
    JOB_CARDS: 'li.job-card-box',
    JOB_TITLE: '.job-name',
    COMPANY_NAME: '.company-name, .job-company',
    LOCATION: '.job-address-desc, .company-location, .job-area',
    CHAT_BUTTON: 'a.op-btn-chat'
  };

  try {
    // Wait for job cards to load
    console.log('Waiting for job cards...');
    try {
      await page.waitForSelector(selectors.JOB_CARDS, { timeout: 15000 });
      console.log('✅ Job cards found');
    } catch (e) {
      console.log('❌ Job cards NOT found (timeout)');
      throw e;
    }

    // Check internal elements of the first card
    const firstCard = await page.$(selectors.JOB_CARDS);
    if (firstCard) {
      const title = await firstCard.$(selectors.JOB_TITLE);
      console.log(title ? '✅ Job title found' : '❌ Job title NOT found');

      const company = await firstCard.$(selectors.COMPANY_NAME);
      console.log(company ? '✅ Company name found' : '❌ Company name NOT found');

      const location = await firstCard.$(selectors.LOCATION);
      console.log(location ? '✅ Location found' : '❌ Location NOT found');
      
      const chatBtn = await firstCard.$(selectors.CHAT_BUTTON);
      console.log(chatBtn ? '✅ Chat button found' : '❌ Chat button NOT found (might need login)');
    }

  } catch (error) {
    console.error('❌ Verification failed or timed out:', error.message);
    console.log('Note: Some selectors might require login or specific search pages.');
  } finally {
    console.log('Closing browser...');
    await browser.close();
  }
}

main();
