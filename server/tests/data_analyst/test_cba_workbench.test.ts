import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCbaNavigatorAnswer,
  contextToPayload,
  normalizeCbaSeedCorpus,
  requiresAnalyzeWorkspace,
  searchCbaChunks,
  searchCbaSections,
} from '../../src/cba/corpus.js';
import type { CbaSearchContext, CbaSeedCorpus } from '../../src/cba/corpus.js';

test('CBA corpus normalization produces stable section and chunk metadata', () => {
  const corpus = normalizeCbaSeedCorpus(fixtureCorpus());

  assert.equal(corpus.document.id, '2023-nba-nbpa-cba');
  assert.deepEqual(corpus.sections.map((section) => section.id), [
    'ARTICLE VII §2(e)',
    'ARTICLE VII §6(e)',
    'ARTICLE VII §8',
  ]);
  assert.equal(corpus.sections[0].chunks?.[0].article_id, 'ARTICLE VII §2(e)');
  assert.equal(corpus.sections[1].chunks?.[0].page_start, 236);
});

test('CBA section search finds mid-level exception sections', () => {
  const corpus = normalizeCbaSeedCorpus(fixtureCorpus());
  const sections = searchCbaSections(corpus.sections, 'mid-level exception');

  assert.equal(sections[0].id, 'ARTICLE VII §6(e)');
  assert.match(sections[0].label, /Non-Taxpayer Mid-Level/);
});

test('CBA chunk search and navigator answer cite retrieved text', () => {
  const corpus = normalizeCbaSeedCorpus(fixtureCorpus());
  const sectionsById = new Map(corpus.sections.map((section) => [section.id, section]));
  const chunks = corpus.sections.flatMap((section) => section.chunks ?? []);
  const contexts = searchCbaChunks(chunks, sectionsById, 'Where is the non-taxpayer MLE defined?');
  const answer = buildCbaNavigatorAnswer('Where is the non-taxpayer MLE defined?', contexts);

  assert.equal(contexts[0].section.id, 'ARTICLE VII §6(e)');
  assert.match(contexts[0].match_kind, /heading|exact_phrase|body/);
  assert.notEqual(contexts[0].support_level, 'weak');
  assert.match(answer.text, /Article VII §6\(e\)/);
  assert.equal(answer.citations[0].article_id, 'ARTICLE VII §6(e)');
  assert.equal(answer.navigate?.article_id, 'ARTICLE VII §6(e)');
  const payload = contextToPayload(contexts[0]);
  assert.equal(payload.article_id, 'ARTICLE VII §6(e)');
  assert.equal(payload.chunk_id, contexts[0].chunk.id);
  assert.equal(payload.page_start, 236);
  assert.equal(typeof payload.score, 'number');
  assert.match(payload.quote, /Non-Taxpayer Mid-Level/);

  const shorthandContexts = searchCbaChunks(chunks, sectionsById, 'where is the non taxpayer mle defined');
  assert.equal(shorthandContexts[0].section.id, 'ARTICLE VII §6(e)');
  assert.match(shorthandContexts[0].chunk.body, /Non-Taxpayer Mid-Level/);
});

test('CBA navigator refuses weakly supported matches instead of forcing citations', () => {
  const corpus = normalizeCbaSeedCorpus(fixtureCorpus());
  const section = corpus.sections[0];
  const chunk = section.chunks?.[0];
  assert.ok(chunk);
  const weakContext: CbaSearchContext = {
    section,
    chunk,
    score: 42,
    match_kind: 'body',
    support_level: 'weak',
  };
  const answer = buildCbaNavigatorAnswer('weird cap thing', [weakContext]);

  assert.match(answer.text, /too weak to answer/i);
  assert.deepEqual(answer.citations, []);
  assert.equal(answer.navigate, null);
});

test('CBA navigator routes live team cap questions to Analyze', () => {
  assert.equal(requiresAnalyzeWorkspace('Can we use the mid-level exception this summer?'), true);
  assert.equal(requiresAnalyzeWorkspace('Where is the mid-level exception defined in the CBA?'), false);

  const answer = buildCbaNavigatorAnswer('Can we use the mid-level exception this summer?', []);
  assert.match(answer.text, /Open Analyze/);
  assert.deepEqual(answer.citations, []);
  assert.equal(answer.boundary?.action, 'open_analyze');
});

function fixtureCorpus(): CbaSeedCorpus {
  return {
    document: {
      id: '2023-nba-nbpa-cba',
      title: '2023 NBA-NBPA Collective Bargaining Agreement',
      source_url: 'https://nbpa.com/cba/',
      effective_date: '2023-07-01',
      season_label: '2023 CBA',
      page_count: 676,
    },
    sections: [
      {
        id: 'ARTICLE VII §8',
        document_id: '2023-nba-nbpa-cba',
        label: 'Article VII §8 - Trade Rules',
        article: 'Article VII',
        section: 'Trade Rules',
        section_number: '8',
        body: 'A Team may trade player contracts only in accordance with the trade rules and matching rules in this section.',
        page_start: 260,
        page_end: 266,
        sort_key: 3,
        aliases: ['trades', 'aggregation'],
        source_url: 'https://nbpa.com/cba/',
      },
      {
        id: 'ARTICLE VII §6(e)',
        document_id: '2023-nba-nbpa-cba',
        label: 'Article VII §6(e) - Non-Taxpayer Mid-Level Salary Exception',
        article: 'Article VII',
        section: 'Non-Taxpayer Mid-Level Salary Exception',
        section_number: '6(e)',
        body: 'A Team may use the Non-Taxpayer Mid-Level Salary Exception to sign one or more Player Contracts during each Salary Cap Year.',
        page_start: 236,
        page_end: 237,
        sort_key: 2,
        aliases: ['non-taxpayer mle', 'mid-level exception', 'ntmle'],
        source_url: 'https://nbpa.com/cba/',
      },
      {
        id: 'ARTICLE VII §2(e)',
        document_id: '2023-nba-nbpa-cba',
        label: 'Article VII §2(e) - Operation of Apron Levels',
        article: 'Article VII',
        section: 'Operation of Apron Levels',
        section_number: '2(e)',
        body: 'The First Apron Level and Second Apron Level govern apron team salary restrictions and related consequences.',
        page_start: 186,
        page_end: 195,
        sort_key: 1,
        aliases: ['first apron', 'second apron'],
        source_url: 'https://nbpa.com/cba/',
      },
    ],
  };
}
