import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  buildCbaNavigatorAnswer,
  contextToPayload,
  normalizeCbaSeedCorpus,
  requiresAnalyzeWorkspace,
  searchCbaChunks,
  searchCbaSectionMatches,
} from '../../src/cba/corpus.js';
import type { CbaSeedCorpus } from '../../src/cba/corpus.js';

type CbaRetrievalEvalCase = {
  id: string;
  message: string;
  expectedSearchArticleId?: string;
  expectedChatArticleId?: string;
  expectedTopChunkId?: string;
  requiredChunkText?: string;
  expectAnalyzeBoundary?: boolean;
  expectNoMatch?: boolean;
};

type CbaRetrievalEvalFixture = {
  cases: CbaRetrievalEvalCase[];
};

const corpusPath = fileURLToPath(new URL('../../../data/cba/2023-nba-nbpa-cba.json', import.meta.url));
const evalPath = fileURLToPath(new URL('../fixtures/cba_retrieval_eval.json', import.meta.url));
const COPY_CITATION_CASES = new Set([
  'ntmle_definition',
  'second_apron',
  'trade_aggregation',
  'bird_rights',
  'sign_and_trade',
]);

test('CBA real-corpus retrieval evals stay source-backed and navigable', async (t) => {
  const [rawCorpus, rawFixture] = await Promise.all([
    readFile(corpusPath, 'utf8'),
    readFile(evalPath, 'utf8'),
  ]);
  const corpus = normalizeCbaSeedCorpus(JSON.parse(rawCorpus) as CbaSeedCorpus);
  const fixture = JSON.parse(rawFixture) as CbaRetrievalEvalFixture;
  const sectionsById = new Map(corpus.sections.map((section) => [section.id, section]));
  const chunks = corpus.sections.flatMap((section) => section.chunks ?? []);

  assert.ok(fixture.cases.length >= 35, 'expected a broad CBA retrieval eval set');

  for (const evalCase of fixture.cases) {
    await t.test(evalCase.id, () => {
      const sectionMatches = searchCbaSectionMatches(corpus.sections, evalCase.message, 5);
      const contexts = searchCbaChunks(chunks, sectionsById, evalCase.message, { limit: 5 });
      const answer = buildCbaNavigatorAnswer(evalCase.message, contexts);

      if (evalCase.expectAnalyzeBoundary) {
        assert.equal(requiresAnalyzeWorkspace(evalCase.message), true, evalCase.message);
        assert.equal(answer.boundary?.action, 'open_analyze', evalCase.message);
        assert.deepEqual(answer.citations, [], evalCase.message);
        assert.equal(answer.navigate, null, evalCase.message);
        assert.match(answer.text, /current team context|cap-sheet data|transaction modeling/i);
        return;
      }

      if (evalCase.expectNoMatch) {
        assert.equal(sectionMatches.length, 0, evalCase.message);
        assert.equal(contexts.length, 0, evalCase.message);
        assert.deepEqual(answer.citations, [], evalCase.message);
        assert.equal(answer.navigate, null, evalCase.message);
        assert.match(answer.text, /could not find/i);
        return;
      }

      assert.ok(sectionMatches.length > 0, `expected section matches for ${evalCase.id}`);
      assert.ok(contexts.length > 0, `expected chunk contexts for ${evalCase.id}`);
      assert.ok(answer.citations.length > 0, `expected citations for ${evalCase.id}`);
      assert.ok(answer.navigate, `expected navigate event for ${evalCase.id}`);
      const payload = contextToPayload(contexts[0]);
      assert.equal(payload.article_id, contexts[0].section.id, evalCase.message);
      assert.equal(payload.chunk_id, contexts[0].chunk.id, evalCase.message);
      assert.equal(typeof payload.score, 'number', evalCase.message);
      assert.match(payload.match_kind, /selected_chunk|active_section|heading|exact_phrase|metadata|body/);
      assert.match(payload.support_level, /strong|medium|weak/);
      assert.ok(payload.quote.length > 0, `expected context quote for ${evalCase.id}`);

      if (evalCase.expectedSearchArticleId) {
        assert.equal(sectionMatches[0].section.id, evalCase.expectedSearchArticleId, evalCase.message);
        assert.ok(sectionMatches[0].snippet.length > 0, `expected search snippet for ${evalCase.id}`);
        assert.ok(sectionMatches[0].match_terms.length > 0, `expected search match terms for ${evalCase.id}`);
      }

      if (evalCase.expectedChatArticleId) {
        assert.equal(contexts[0].section.id, evalCase.expectedChatArticleId, evalCase.message);
        assert.equal(answer.navigate.article_id, evalCase.expectedChatArticleId, evalCase.message);
        assert.equal(answer.citations[0].article_id, evalCase.expectedChatArticleId, evalCase.message);
      }

      if (evalCase.expectedTopChunkId) {
        assert.equal(contexts[0].chunk.id, evalCase.expectedTopChunkId, evalCase.message);
        assert.equal(answer.navigate.chunk_id, evalCase.expectedTopChunkId, evalCase.message);
      }

      if (evalCase.requiredChunkText) {
        assert.match(
          normalizeForAssertion(contexts[0].chunk.body),
          new RegExp(escapeRegExp(normalizeForAssertion(evalCase.requiredChunkText)), 'i'),
          evalCase.message,
        );
      }

      if (COPY_CITATION_CASES.has(evalCase.id)) {
        assert.ok(answer.citations[0].quote.length > 0, `expected copy-ready quote for ${evalCase.id}`);
        assert.notEqual(answer.citations[0].page_start, null, `expected citation page for ${evalCase.id}`);
        assert.notEqual(payload.page_start, null, `expected context page for ${evalCase.id}`);
        assert.notEqual(payload.support_level, 'weak', `expected supported copy citation for ${evalCase.id}`);
      }
    });
  }
});

function normalizeForAssertion(value: string): string {
  return value
    .replace(/([A-Za-z])\s*-\s*([A-Za-z])/g, '$1-$2')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
