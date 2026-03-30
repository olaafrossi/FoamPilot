import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
await browser.close();
console.log('ok - node');
