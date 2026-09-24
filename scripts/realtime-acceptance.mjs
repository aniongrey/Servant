import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const consoleErrors = [];
let createdReminder = null;
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => consoleErrors.push(error.message));

try {
  await page.goto('http://localhost:5173/realtime-test', { waitUntil: 'networkidle' });
  await page.getByText('5174 已连接').waitFor({ timeout: 10_000 });

  await page.getByRole('button', { name: '刷新列表' }).click();
  await page.getByText('提醒列表已经整理好了。', { exact: true }).first().waitFor({ timeout: 10_000 });

  const taskName = '自动验收临时任务：这是一段专门用于确认提醒名称、内容与任务 ID 都会自动换行的长文本';
  await page.getByLabel('几秒后').fill('120');
  await page.getByLabel('提醒内容').fill(taskName);
  await page.getByRole('button', { name: '新增一次性任务' }).click();
  const reminder = page.locator('.reminderQueue article').filter({ hasText: taskName });
  createdReminder = reminder;
  await reminder.waitFor({ timeout: 10_000 });
  const wraps = await reminder.locator('strong').evaluate((element) => {
    const style = getComputedStyle(element);
    return style.whiteSpace !== 'nowrap' && element.scrollWidth <= element.clientWidth;
  });
  if (!wraps) throw new Error('提醒列表长文本没有正确自动换行。');
  await reminder.getByRole('button', { name: '删除' }).click();
  createdReminder = null;
  await page.getByText('提醒已经删除了。', { exact: true }).first().waitFor({ timeout: 10_000 });

  const startedBaseline = await page.getByText('桌宠开始处理', { exact: true }).count();
  await page.getByRole('button', { name: '一键开始防打断场景' }).click();
  await page.waitForTimeout(1_500);
  const startedBeforeRelease = await page.getByText('桌宠开始处理', { exact: true }).count();
  if (startedBeforeRelease !== startedBaseline) throw new Error('提醒在占用语音期间开始执行，防打断失败。');
  await page.getByRole('button', { name: '释放语音' }).click();
  await page.waitForFunction(
    (baseline) =>
      [...document.querySelectorAll('b')].filter((node) => node.textContent === '桌宠开始处理').length >
      baseline,
    startedBaseline,
    { timeout: 10_000 }
  );

  await page.getByRole('button', { name: '执行联网查询' }).click();
  await page.getByText('资料已返回，等待角色总结', { exact: true }).first().waitFor({ timeout: 50_000 });
  const searchPayload = await page.locator('.resultCard pre').innerText();
  if (!searchPayload.includes('"results"') || !searchPayload.includes('"url"')) {
    throw new Error(`联网查询成功话术缺少结果正文：${searchPayload}`);
  }

  if (consoleErrors.length > 0) throw new Error(`页面控制台错误：${consoleErrors.join(' | ')}`);
  console.log(
    'PASS realtime acceptance: list, add, wrap, remove, no-interrupt queue, release, successful web-search'
  );
} finally {
  if (createdReminder && (await createdReminder.count())) {
    await createdReminder
      .getByRole('button', { name: '删除' })
      .click()
      .catch(() => undefined);
  }
  await browser.close();
}
