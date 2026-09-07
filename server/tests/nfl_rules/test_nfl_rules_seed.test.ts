import test from 'node:test';
import assert from 'node:assert/strict';
import { loadNflRulesCorpus, validateNflRulesCorpus } from '../../src/nfl_rules/seed.js';
import { nflRoutes } from '../../src/routes/nfl.js';

test('NFL rules corpus loads bounded transaction rule families', async () => {
  const corpus = await loadNflRulesCorpus();
  const families = new Set(corpus.rules.map((rule) => rule.rule_family));

  assert.equal(corpus.schema_version, 1);
  assert.equal(corpus.source_name, 'Executed 2020 NFL-NFLPA CBA and NFL Football Operations');
  assert.ok(families.has('restructure_conversion'));
  assert.ok(families.has('post_june_1_accounting'));
  assert.ok(families.has('franchise_transition_tag'));
  assert.ok(families.has('salary_cap_accounting'));
  assert.ok(corpus.rules.every((rule) => rule.source_locator && rule.effective_date && rule.analysis_boundary));
  assert.ok(corpus.rules.filter((rule) => rule.authority_type === 'executed_cba').every((rule) => /^sha256:[a-f0-9]{64}$/.test(rule.source_hash ?? '')));
});

test('executed CBA authority rejects truncated or malformed content hashes', async () => {
  const corpus = structuredClone(await loadNflRulesCorpus());
  const executed = corpus.rules.find((rule) => rule.authority_type === 'executed_cba');
  assert.ok(executed);
  executed.source_hash = 'sha256:0ff491731e6ab8c21dd2b284b650b1f2a97d943a3850ebee';
  assert.throws(() => validateNflRulesCorpus(corpus), /valid executed-CBA SHA-256/);
});

test('NFL rules routes expose corpus sections and Analyze handoff boundary', async () => {
  const toc = await nflRoutes.request('/rules');
  assert.equal(toc.status, 200);
  const tocBody = await toc.json() as { document: { title: string }; sections: Array<{ id: string; label: string }> };
  assert.equal(tocBody.document.title, 'NFL Rules Authority Pack');
  assert.equal(tocBody.sections.some((section) => section.id === 'restructure_conversion'), true);

  const article = await nflRoutes.request('/rules/articles/restructure_conversion');
  assert.equal(article.status, 200);
  const articleBody = await article.json() as { section: { label: string }; chunks: Array<{ body: string }> };
  assert.equal(articleBody.section.label, 'Salary-to-signing-bonus restructure');
  assert.match(articleBody.chunks[0]?.body ?? '', /exact relief/);

  const chat = await nflRoutes.request('/rules/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'We are the Giants. Should we restructure or tag a veteran?' }),
  });
  assert.equal(chat.status, 200);
  const stream = await chat.text();
  assert.match(stream, /"type":"citation"/);
  assert.match(stream, /restructure_conversion/);
  assert.match(stream, /"type":"boundary"/);
  assert.match(stream, /team_specific_nfl_rules_question/);
});
