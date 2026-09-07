import 'dotenv/config';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { chromium, type Locator, type Page } from 'playwright';

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
    if (message.type() === 'error' && !/favicon|eventsource|progress stream/i.test(message.text())) browserErrors.push(message.text());
  });
  let createdSessionId: string | null = null;
  page.on('response', (response) => {
    if (response.request().method() !== 'POST' || !/\/rest\/v1\/sessions(?:\?|$)/.test(response.url())) return;
    void response.json().then((body: unknown) => {
      if (isRecord(body) && typeof body.id === 'string') createdSessionId = body.id;
      if (Array.isArray(body) && isRecord(body[0]) && typeof body[0].id === 'string') createdSessionId = body[0].id;
    }).catch(() => undefined);
  });
  let primaryError: unknown = null;

  try {
    await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
    await page.getByText('What do you want to analyze?', { exact: true }).waitFor({ timeout: 20_000 });
    await assertRetiredUiAbsent(page);

    await submit(page, tyQuestion);
    await page.getByTestId('nfl-transaction-market-analysis').waitFor({ timeout: 20_000 });
    await assertRetiredUiAbsent(page);

    await submit(page, 'What if we moved Brian Burns for a 2027 second?');
    const result = page.getByTestId('nfl-seller-move-result');
    await result.waitFor({ timeout: 20_000 });
    await result.getByText(/2027 round 2 pick \(Day 2\) for Brian Burns/i).waitFor();
    const regenerate = page.getByText('Regenerate', { exact: true });
    if (await regenerate.isVisible()) {
      console.error('[qa] visible regenerate:', await regenerate.evaluate((element) => element.parentElement?.parentElement?.outerHTML));
    }
    assert(!(await regenerate.isVisible()), 'Seller answer exposed destructive regeneration.');
    const burnsSecond = await playerFacts(result);
    assert.match(await result.innerText(), /Most relevant trades/i);

    const roundFollowup = result.getByRole('button', { name: 'Make it a first.', exact: true });
    await roundFollowup.waitFor({ timeout: 10_000 });
    await roundFollowup.click();
    await result.getByText(/2027 round 1 pick \(Day 1\) for Brian Burns/i).waitFor({ timeout: 20_000 });
    const burnsFirst = await playerFacts(result);
    assert.deepEqual(burnsFirst, burnsSecond, 'Pick-only edit changed player-dependent cap or depth facts.');
    assert.match(await result.innerText(), /Weaker return than your proposal/i);

    await submit(page, 'What about Thibodeaux instead?');
    await result.getByText(/2027 round 1 pick \(Day 1\) for Kayvon Thibodeaux/i).waitFor({ timeout: 20_000 });
    const thibodeaux = await playerFacts(result);
    assert.notDeepEqual(thibodeaux, burnsFirst, 'Player edit did not change contract or role facts.');

    await submit(page, 'Use 2028.');
    await result.getByText(/2028 round 1 pick \(Day 1\) for Kayvon Thibodeaux/i).waitFor({ timeout: 20_000 });

    await submit(page, 'Show me the trades behind that.');
    await result.getByText('Trades behind this result', { exact: true }).waitFor({ timeout: 20_000 });
    const comparableButton = result.getByRole('button', { name: /Open transaction evidence/ }).first();
    const comparableName = (await comparableButton.innerText()).split('\n')[0]?.trim();
    await comparableButton.click();
    await page.getByRole('heading', { name: `Transaction · ${comparableName}` }).waitFor({ timeout: 15_000 });
    const closeEvidence = page.getByRole('button', { name: 'Close evidence panel' });
    if (await closeEvidence.isVisible()) await closeEvidence.click();

    await result.getByText('See calculation and sources', { exact: true }).click();
    await result.getByRole('button', { name: 'Open player contract evidence' }).click();
    await page.getByRole('heading', { name: 'Contract · Kayvon Thibodeaux' }).waitFor({ timeout: 15_000 });
    await assertRetiredUiAbsent(page);
    assert.deepEqual(browserErrors, [], `Browser runtime errors: ${browserErrors.join(' | ')}`);
    console.log(`[qa] conversational seller-move smoke ${viewport.width}x${viewport.height}: PASS`);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    await context.close();
    await browser.close();
    if (createdSessionId) {
      const deleted = await database.from('sessions').delete().eq('id', createdSessionId);
      if (deleted.error) {
        const cleanupError = new Error(`Could not remove QA-owned session ${createdSessionId}: ${deleted.error.message}`);
        if (primaryError) console.error(`[qa] cleanup also failed: ${cleanupError.message}`);
        else throw cleanupError;
      }
    }
  }
}

async function submit(page: Page, text: string) {
  const composer = page.getByRole('textbox').first();
  await composer.fill(text);
  await composer.press('Enter');
  await page.locator('main').last().getByText(text, { exact: true }).last().waitFor({ timeout: 20_000 });
  const nextComposer = page.getByRole('textbox').first();
  await nextComposer.waitFor({ state: 'visible', timeout: 20_000 });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('textarea'))
    .some((element) => element instanceof HTMLTextAreaElement && element.offsetParent !== null && !element.disabled),
  undefined, { timeout: 20_000 });
}

async function playerFacts(result: Locator) {
  return {
    capSpace: await result.locator('[data-result-metric*="cap space created"]').innerText(),
    deadMoney: await result.locator('[data-result-metric*="dead money"]').innerText(),
    depth: await result.locator('[data-result-metric="Depth consequence"]').innerText(),
  };
}

async function assertRetiredUiAbsent(page: Page) {
  const analysisCanvas = page.locator('main').last();
  assert.equal(await page.getByText('Cap analysis', { exact: true }).count(), 0);
  assert.equal(await analysisCanvas.getByText('Model a move', { exact: true }).count(), 0);
  assert.equal(await analysisCanvas.getByText('Seller-side check', { exact: true }).count(), 0);
  assert.equal(await analysisCanvas.getByLabel('Position group').count(), 0);
  assert.equal(await analysisCanvas.getByLabel('Giants player').count(), 0);
  assert.equal(await page.getByText('Analyze 10-year position markets', { exact: true }).count(), 0);
  assert.equal(await page.getByText('answer format', { exact: true }).count(), 0);
  assert.equal(await page.locator('.branch-card').count(), 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

if (path.resolve(process.argv[1] ?? '') === sourceFile) {
  void runModelMoveSmoke().catch((error) => {
    console.error('[qa] conversational seller-move smoke: FAIL', error);
    process.exitCode = 1;
  });
}
