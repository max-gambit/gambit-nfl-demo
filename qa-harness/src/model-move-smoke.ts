import 'dotenv/config';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';

const sourceFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(sourceFile), '..', '..');
dotenv.config({ path: path.join(repoRoot, 'server', '.env') });
dotenv.config({ path: path.join(repoRoot, '.env.local') });

const appUrl = process.env.QA_APP_URL ?? 'http://localhost:5173';
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const tyQuestion = 'Which position markets have grown or shrunk over the last 10 years, and what does that imply for trade strategy?';

export async function runModelMoveSmoke(viewport = { width: 1440, height: 900 }) {
  assert(supabaseUrl && serviceRoleKey, 'Local Supabase credentials are required for scoped cleanup.');
  const database = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport, locale: 'en-US' });
  const page = await context.newPage();
  const browserErrors: string[] = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/favicon/i.test(message.text())) browserErrors.push(message.text());
  });
  let createdSessionId: string | null = null;
  page.on('response', (response) => {
    if (response.request().method() !== 'POST' || !/\/rest\/v1\/sessions(?:\?|$)/.test(response.url())) return;
    void response.json().then((body: unknown) => {
      if (isRecord(body) && typeof body.id === 'string') createdSessionId = body.id;
      if (Array.isArray(body) && isRecord(body[0]) && typeof body[0].id === 'string') createdSessionId = body[0].id;
    }).catch(() => undefined);
  });

  try {
    await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
    await page.getByText('What do you want to analyze?', { exact: true }).waitFor({ timeout: 20_000 });
    assert.equal(await page.getByText('Cap analysis', { exact: true }).count(), 0);
    assert.equal(await page.getByText('answer format', { exact: true }).count(), 0);
    assert.equal(await page.getByText('Analyze 10-year position markets', { exact: true }).count(), 0);

    const composer = page.getByRole('textbox').first();
    await composer.fill(tyQuestion);
    await composer.press('Enter');
    await page.getByTestId('nfl-transaction-market-analysis').waitFor({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Model a move', exact: true }).click();
    try {
      await page.getByLabel('Position group').waitFor({ timeout: 15_000 });
    } catch (error) {
      console.error('[qa] visible text after opening move:', (await page.locator('body').innerText()).slice(-4_000));
      throw error;
    }
    await page.getByTestId('nfl-model-move-result').waitFor({ timeout: 20_000 });

    const initial = await page.getByTestId('nfl-model-move-result').innerText();
    assert.match(initial, /cap space created/i);
    assert.match(initial, /dead money/i);
    assert.match(initial, /Depth consequence/i);
    assert.match(initial, /Most relevant trades/i);

    await page.getByLabel('Pick round').selectOption('1');
    await page.getByText(/round 1 pick \(Day 1\)/i).waitFor({ timeout: 15_000 });
    const firstRound = await page.getByTestId('nfl-model-move-result').innerText();
    await page.getByLabel('Pick round').selectOption('7');
    await page.getByText(/round 7 pick \(Day 3\)/i).waitFor({ timeout: 15_000 });
    const seventhRound = await page.getByTestId('nfl-model-move-result').innerText();
    assert.notEqual(firstRound, seventhRound, 'Changing the proposed pick did not change the result.');

    const playerSelect = page.getByLabel('Giants player');
    const playerValues = await playerSelect.locator('option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value).filter(Boolean));
    if (playerValues.length > 1) {
      const beforePlayer = await page.getByTestId('nfl-model-move-result').innerText();
      await playerSelect.selectOption(playerValues[1]);
      await page.waitForFunction((before) => document.querySelector('[data-testid="nfl-model-move-result"]')?.textContent !== before, beforePlayer, { timeout: 15_000 });
    }

    const moveResult = page.getByTestId('nfl-model-move-result');
    await moveResult.getByText('See calculation and sources', { exact: true }).click();
    assert(await moveResult.getByRole('link', { name: 'Open player contract source' }).isVisible());
    assert(await moveResult.getByRole('link', { name: /Open transaction source/ }).first().isVisible());
    assert.equal(await page.locator('.branch-card').count(), 0);
    assert.equal(await page.getByText('Preserve depth', { exact: true }).count(), 0);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText('What do you want to analyze?', { exact: true }).waitFor({ timeout: 20_000 });
    assert.equal(await page.getByTestId('nfl-transaction-market-analysis').count(), 0, 'Reload restored a prior answer instead of the clean composer.');
    assert.deepEqual(browserErrors, [], `Browser runtime errors: ${browserErrors.join(' | ')}`);
    console.log(`[qa] model-move smoke ${viewport.width}x${viewport.height}: PASS`);
  } finally {
    await context.close();
    await browser.close();
    if (createdSessionId) {
      const deleted = await database.from('sessions').delete().eq('id', createdSessionId);
      if (deleted.error) throw new Error(`Could not remove QA-owned session ${createdSessionId}: ${deleted.error.message}`);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

if (path.resolve(process.argv[1] ?? '') === sourceFile) {
  void runModelMoveSmoke().catch((error) => {
    console.error('[qa] model-move smoke: FAIL', error);
    process.exitCode = 1;
  });
}
