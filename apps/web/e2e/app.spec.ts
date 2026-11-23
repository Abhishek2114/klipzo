import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const sample = fileURLToPath(new URL('../../../packages/schema/fixtures/v1-sample.json', import.meta.url));

test('opens a valid project and shows its summary', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Open project').setInputFiles(sample);
  await expect(page.getByText('Project loaded')).toBeVisible();
  await expect(page.locator('.project-name')).toHaveText('Chai pe charcha – episode 4');
});

test('explains why a broken file cannot be opened', async ({ page }) => {
  await page.goto('/');
  await page
    .getByLabel('Open project')
    .setInputFiles({ name: 'bad.klipzo', mimeType: 'application/json', buffer: Buffer.from('{"schemaVersion": 99}') });
  await expect(page.getByRole('alert')).toContainText('newer Klipzo');
  await page
    .getByLabel('Open project')
    .setInputFiles({ name: 'garbage.klipzo', mimeType: 'application/json', buffer: Buffer.from('not json') });
  await expect(page.getByRole('alert')).toContainText('not valid JSON');
});

test('switches the interface to Hindi and remembers it', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Language').selectOption('hi');
  await expect(page.getByText('प्रोजेक्ट खोलें')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'hi');
  await page.reload();
  await expect(page.getByText('प्रोजेक्ट खोलें')).toBeVisible();
});

test('theme can be forced to dark', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Theme').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
