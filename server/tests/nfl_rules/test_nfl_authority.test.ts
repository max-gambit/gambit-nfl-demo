import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { getNflAuthorityCoverage, loadNflAuthorityCorpus, NFL_AUTHORITY_TOPICS, searchNflAuthority, searchNflAuthorityPassages } from '../../src/nfl_authority/index.js';

test('captured corpus verifies every exact source, page and source-manifest binding', async () => {
  const corpus = await loadNflAuthorityCorpus();
  const manifest = JSON.parse(await readFile(new URL('../../../data/nfl-authority/manifest.json', import.meta.url), 'utf8'));
  const data = await readFile(new URL('../../../data/nfl-authority/authority.json.gz', import.meta.url));
  assert.equal(createHash('sha256').update(data).digest('hex'), manifest.index_sha256);
  assert.ok(corpus.passages.length > 1500);
  assert.equal(new Set(corpus.passages.map(p => p.id)).size, corpus.passages.length);
  assert.equal(corpus.sources.find(s => s.id === 'nfl-cba-2020-executed')?.pdf_page_count, 456);
  assert.equal(corpus.sources.find(s => s.id === 'nfl-playing-rules-2026')?.pdf_page_count, 91);
  const cbaArticles = new Set(corpus.passages.filter(p => p.domain === 'cba').map(p => p.locator.match(/^Article (\d+[A-Z]?)/)?.[1]).filter(Boolean));
  assert.equal(cbaArticles.size, 70, 'Articles 1–68 plus 55A/63A are text-indexed; scanned Article 69 is an explicit gap');
  assert.ok(cbaArticles.has('55A'));
  assert.ok(cbaArticles.has('63A'));
  assert.ok(corpus.sources.find(s => s.id === 'nfl-cba-2020-executed')?.unindexed_pdf_pages?.includes(350));
  const playingRules = new Set(corpus.passages.filter(p => p.domain === 'playing_rules').map(p => p.locator.match(/^Rule (\d+)/)?.[1]).filter(Boolean));
  assert.equal(playingRules.size, 19);
  for (const passage of corpus.passages) {
    const source = corpus.sources.find(s => s.id === passage.source_id)!;
    assert.ok(source);
    assert.equal(source.league, 'NFL');
    assert.equal(passage.url.split('#')[0], source.url);
    assert.ok(passage.text.length > 0);
    if (passage.pdf_page !== null) assert.equal(passage.url.split('#')[1], `page=${passage.pdf_page}`);
  }
});

test('guarantee definitions bind to the official explainer without representing an individual contract', async () => {
  const result = await searchNflAuthority({ question: 'What is the difference between an injury-only guarantee and fully guaranteed money?' });
  assert.equal(result.sources[0]?.data?.source_id, 'nfl-contract-guarantees-guide');
  assert.match(String(result.sources[0]?.data?.excerpt), /skill, cap and\/or injury/);
  assert.match(String(result.sources[0]?.data?.authority_boundary), /explanatory guide/);
  assert.match(result.body.caveats.join(' '), /executed contract and amendments/);
  assert.deepEqual(result.body.calculations, []);
});

test('signing-bonus proration retrieves the five-year clause and its exception, not a computed savings claim', async () => {
  const result = await searchNflAuthority({ question: 'How many years can a signing bonus be prorated?', limit: 2 });
  const primary = result.sources[0]?.data;
  assert.equal(primary?.source_locator, 'Article 13, Section 6');
  assert.equal(primary?.pdf_page, 126);
  assert.equal(primary?.printed_page, '109');
  assert.match(String(primary?.excerpt), /maximum proration of five years/);
  assert.match(String(primary?.excerpt), /sole control/);
  assert.match(result.body.caveats.join(' '), /unilateral restructure right/);
  assert.deepEqual(result.body.calculations, []);
});

test('June 1 evidence preserves separate advance termination designation, actual trade and Final League Year exception', async () => {
  const result = await searchNflAuthority({ question: 'Can a trade be designated post-June 1 the same as a release?', limit: 3 });
  const text = result.sources.map(s => s.data?.excerpt).join(' ');
  assert.equal(result.sources[0]?.data?.pdf_page, 127);
  assert.match(text, /designate up to two/);
  assert.match(text, /not renegotiated after the last regular season game/);
  assert.match(text, /assigned via waivers or trade after June 1/);
  assert.match(text, /except in the Final League Year/);
  assert.match(result.body.caveats.join(' '), /agreement’s final League Year/);
  assert.ok(result.sources.slice(0, 2).every(s => s.data?.pdf_page === 127));
});

test('current practice-squad count prioritizes the dated league evidence and flags original-CBA limits', async () => {
  const result = await searchNflAuthority({ question: 'How many players can be on the practice squad in 2026?' });
  assert.equal(result.sources[0]?.data?.domain, 'league_dates');
  assert.match(String(result.sources[0]?.data?.excerpt), /Practice Squad of 17 players, as long as one player qualifies and is designated as an International Player/);
  assert.match(result.body.caveats.join(' '), /do not apply original CBA limits as current policy/);
});

test('waivers preserve pension-credited service, timing and current calendar evidence', async () => {
  const result = await searchNflAuthority({ question: 'Does a veteran with four credited seasons go through waivers after the trade deadline?' });
  assert.equal(result.sources[0]?.data?.source_locator, 'Article 29, Section 1');
  assert.match(result.sources.map(s => s.data?.excerpt).join(' '), /four previous pension-credited seasons/);
  assert.match(result.body.caveats.join(' '), /no live waiver order/);
});

test('2018-and-later fifth-year guarantee clause outranks older draft-class provisions', async () => {
  const result = await searchNflAuthority({ question: 'Is the fifth-year option guaranteed when exercised for a 2023 first-round pick?', limit: 2 });
  assert.equal(result.sources[0]?.data?.pdf_page, 60);
  assert.match(String(result.sources[0]?.data?.excerpt), /2018 or any subsequent Draft/);
  assert.match(String(result.sources[0]?.data?.excerpt), /guaranteed for skill, injury, and Salary Cap-related termination, effective upon/);
  assert.match(result.body.caveats.join(' '), /2016–2017 draft classes/);
});

test('RFA second-round tender ranks the restricted-free-agent provision above franchise tenders', async () => {
  const result = await searchNflAuthority({ question: 'How does an RFA second-round tender work?', limit: 3 });
  assert.ok(result.sources.every(s => s.data?.source_locator === 'Article 9, Section 2'));
  assert.match(result.sources.map(s => s.data?.excerpt).join(' '), /second round/);
  assert.match(result.body.caveats.join(' '), /Current tender dollar amounts/);
});

test('2026 onside-kick scenario retrieves the changed rule with declaration conditions', async () => {
  const result = await searchNflAuthority({ question: 'Can a team that is ahead declare an onside kick in the first quarter in 2026?' });
  assert.equal(result.sources[0]?.data?.source_locator, 'Rule 6, Section 1, Article 6');
  assert.equal(result.sources[0]?.data?.pdf_page, 30);
  assert.match(String(result.sources[0]?.data?.excerpt), /At any time during the game/);
  assert.match(String(result.sources[0]?.data?.excerpt), /notifying the Referee prior to the start of the play clock/);
  assert.ok(result.sources.every(s => s.data?.domain === 'playing_rules'));
});

test('catch scenario ranks source-body content about control, inbounds contact and the football act', async () => {
  const result = await searchNflAuthority({ question: 'Is it a catch if the receiver controls the ball with one foot and a knee inbounds?' });
  assert.equal(result.sources[0]?.data?.source_locator, 'Rule 8, Section 1, Article 3');
  assert.match(String(result.sources[0]?.data?.excerpt), /any part of his body other than his hands/);
  assert.match(String(result.sources[0]?.data?.excerpt), /control of the ball/);
});

test('regular-season overtime includes the possession opportunity and ten-minute limit together', async () => {
  const result = await searchNflAuthority({ question: 'Does an opening touchdown end regular-season overtime in 2026?' });
  assert.equal(result.sources[0]?.data?.source_locator, 'Rule 16, Section 1, Article 3');
  const text = String(result.sources[0]?.data?.excerpt);
  assert.match(text, /Both teams must have the opportunity to possess/);
  assert.match(text, /maximum of one 10-minute period/);
  assert.match(text, /even if the second team has not had an opportunity/);
});

test('body-only language works without a hand-authored topic alias or matching title', async () => {
  const result = await searchNflAuthorityPassages({ question: 'Can the quarterback spike to stop the clock after waiting before the throw?', domain: 'playing_rules' });
  assert.equal(result.status, 'supported');
  assert.deepEqual(result.topic_ids, []);
  assert.ok(result.matches.some(m => m.passage.locator === 'Rule 8, Section 2, Article 1' && /Delayed Spike/.test(m.passage.text)));
});

test('calendar binds the 2026 trade deadline and does not borrow an uncaptured 2026 start from 2027', async () => {
  const deadline = await searchNflAuthority({ question: 'What is the 2026 trade deadline?' });
  assert.equal(deadline.sources.length, 1);
  assert.match(String(deadline.sources[0]?.data?.source_locator), /November 10, 2026/);
  assert.match(String(deadline.sources[0]?.data?.excerpt), /All trading ends for 2026 at 4:00 p.m., New York time/);
  const uncaptured = await searchNflAuthority({ question: 'What is the 2026 league year start date?' });
  assert.deepEqual(uncaptured.sources, []);
});

test('NBA, different playing editions, future rules, evaluations and unrelated questions fail closed', async () => {
  for (const question of ['How does the NBA second apron trade rule work?', 'What were onside kick rules in 2025?', 'What will NFL trade rules be in 2032?', 'Who is the Giants best pass rusher right now?', 'Explain quantum mechanics', 'What is the price of bitcoin?']) {
    const result = await searchNflAuthority({ question });
    assert.deepEqual(result.sources, [], question);
    assert.deepEqual(result.body.calculations, [], question);
  }
});

test('source references and displayed excerpts remain exactly bound with a clamped result limit', async () => {
  const result = await searchNflAuthority({ question: 'Explain intentional grounding outside the pocket', limit: 999 });
  assert.ok(result.sources.length <= 8);
  assert.equal(result.body.language_policy, 'facts_only_v1');
  const corpus = await loadNflAuthorityCorpus();
  for (const [index, source] of result.sources.entries()) {
    const passage = corpus.passages.find(p => p.id === source.data?.passage_id)!;
    assert.ok(passage);
    assert.equal(source.ref_index, index + 1);
    assert.equal(source.data?.excerpt, passage.text);
    assert.equal(result.body.key_findings[index].body, passage.text);
    assert.deepEqual(result.body.key_findings[index].source_refs, [index + 1]);
    assert.equal(result.body.tables[0].rows[index][2], passage.text);
  }
  const coverage = await getNflAuthorityCoverage();
  assert.match(coverage.text_extraction_boundary, /rotated exhibit text/);
  assert.ok(NFL_AUTHORITY_TOPICS.length >= 20);
});
