import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReviewedNflAuthoritySummaries, searchNflAuthority, searchNflAuthorityPassages } from '../../src/nfl_authority/index.js';

const rehearsalCases = [
  { question: 'Does converting base salary to signing bonus reduce cash or just prorate the cap hit?', topic: 'bonus_proration', expected: /does not itself reduce the cash owed.*up to five years/s, condition: /payment timing and permission depend/ },
  { question: 'Can a trade agreed before June 1 be designated post-June 1, or can it actually be processed afterward?', topic: 'june_1', expected: /cannot use an advance post-June 1 designation.*only if actually assigned after June 1/s, condition: /not renegotiated after.*Final League Year/s },
  { question: 'What is the 2026 practice squad size compared with the original CBA?', topic: 'practice_squad', expected: /17-player.*12 players in 2020–2021 and 14 from 2022/s, condition: /qualifies and is designated as an International Player/ },
  { question: 'Does a veteran with four credited seasons go through waivers after the trade deadline?', topic: 'waivers', expected: /Bert Bell\/Pete Rozelle.*November 11/s, condition: /player’s actual credited service and transaction timing/ },
  { question: 'Is the fifth-year option fully guaranteed for a first-round pick drafted in 2021?', topic: 'fifth_year_option', expected: /2018 draft onward.*guarantees the option-year base salary.*fourth-year base salary/s, condition: /guarantee-voiding terms/ },
  { question: 'What is the 2026 NFL trade deadline?', topic: 'league_deadlines', expected: /4:00 p.m. Eastern on November 10, 2026/, condition: /subject to change/ },
  { question: 'Can a team ahead in the first quarter declare an onside kick in 2026?', topic: 'onside_kick', expected: /2026 rulebook.*at any time.*while ahead in the first quarter/s, condition: /before the play clock starts/ },
  { question: 'Does an opening touchdown end regular-season overtime in 2026?', topic: 'overtime', expected: /touchdown does not automatically end.*one 10-minute overtime period/s, condition: /safety.*even if the second team has not possessed.*tie/s },
] as const;

test('all eight rehearsed rules receive a reviewed, source-bound summary ahead of retained passages', async () => {
  for (const { question, expected, condition } of rehearsalCases) {
    const answer = await searchNflAuthority({ question });
    const summary = answer.body.key_findings[0];
    assert.equal(summary?.label, 'Rule summary', question);
    assert.match(summary.body, expected, question);
    assert.match(summary.body, condition, question);
    assert.ok(summary.source_refs.length > 0, question);
    assert.ok(summary.source_refs.every(ref => answer.sources.some(s => s.ref_index === ref)), question);
    const passages = answer.body.key_findings.filter(f => f.label !== 'Rule summary');
    assert.equal(passages.length, answer.sources.length, question);
    for (const [index, source] of answer.sources.entries()) {
      assert.equal(passages[index].body, source.data?.excerpt, question);
      assert.deepEqual(passages[index].source_refs, [source.ref_index], question);
      assert.equal(answer.body.tables[0].rows[index][2], source.data?.excerpt, question);
    }
    assert.deepEqual(answer.body.calculations, [], question);
  }
});

test('a topic or question match cannot create a summary when required retrieved evidence is removed', async () => {
  for (const { question, topic } of rehearsalCases) {
    const result = await searchNflAuthorityPassages({ question });
    const summaries = buildReviewedNflAuthoritySummaries(result);
    assert.equal(summaries.length, 1, question);
    const required = summaries[0].source_refs[0];
    const incomplete = { ...result, matches: result.matches.filter((_, i) => i + 1 !== required), topic_ids: [topic] };
    assert.deepEqual(buildReviewedNflAuthoritySummaries(incomplete), [], question);
    assert.deepEqual(buildReviewedNflAuthoritySummaries({ ...result, matches: [], topic_ids: [topic] }), [], question);
  }
});

test('summaries reject another source, wrong edition/year, or changed controlling clause', async () => {
  const onside = await searchNflAuthorityPassages({ question: rehearsalCases[6].question });
  const clone = () => structuredClone(onside);
  const wrongEdition = clone();
  wrongEdition.matches.forEach(m => { m.source.edition_year = 2025; });
  assert.deepEqual(buildReviewedNflAuthoritySummaries(wrongEdition), []);
  const wrongSource = clone();
  wrongSource.matches.forEach(m => { m.source.id = 'third-party-summary'; m.passage.source_id = 'third-party-summary'; });
  assert.deepEqual(buildReviewedNflAuthoritySummaries(wrongSource), []);
  const wrongClause = clone();
  wrongClause.matches.forEach(m => { m.passage.text = m.passage.text.replace('At any time during the game', 'Only in the fourth quarter'); });
  assert.deepEqual(buildReviewedNflAuthoritySummaries(wrongClause), []);
  const deadline = await searchNflAuthorityPassages({ question: rehearsalCases[5].question });
  deadline.matches.forEach(m => { m.passage.season_year = 2027; });
  assert.deepEqual(buildReviewedNflAuthoritySummaries(deadline), []);
});

test('uncaptured deadlines, old option classes and old playing editions receive no modern summary', async () => {
  for (const question of ['What is the 2026 league year start date?', 'What were onside kick rules in 2025?', 'Was the fifth-year option fully guaranteed at exercise for a 2016 first-round pick?', 'How does the NBA second apron rule work?']) {
    const answer = await searchNflAuthority({ question });
    assert.ok(answer.body.key_findings.every(f => f.label !== 'Rule summary'), question);
  }
});
