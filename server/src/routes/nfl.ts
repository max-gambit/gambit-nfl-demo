import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type {
  CbaArticleResponse,
  CbaChatRequest,
  CbaChatStreamEvent,
  CbaChunk,
  CbaCitation,
  CbaDocument,
  CbaSearchContextPayload,
  CbaSearchResponse,
  CbaSection,
  CbaTocResponse,
} from '@shared/types';
import {
  groupNflTeams,
  loadCurrentNflDataWithMode,
  nflTeamDetail,
} from '../nfl_data/seed.js';
import { buildNflCoverageMatrix, buildNflCoverageTeam } from '../nfl_coverage/index.js';
import { loadNflRulesCorpus, type NflRuleRow } from '../nfl_rules/seed.js';

export const nflRoutes = new Hono();

nflRoutes.get('/rosters/current', async (c) => {
  const { seed, source_mode, fallback_reason } = await loadCurrentNflDataWithMode();
  return c.json({
    ...groupNflTeams(seed),
    source_mode,
    fallback_reason,
    rows: seed.roster_entries,
  });
});

nflRoutes.get('/cap-sheets/current', async (c) => {
  const { seed, source_mode, fallback_reason } = await loadCurrentNflDataWithMode();
  return c.json({
    ...groupNflTeams(seed),
    source_mode,
    fallback_reason,
    rows: seed.cap_rows,
  });
});

nflRoutes.get('/cap-sheets/current/:teamId', async (c) => {
  const { seed, source_mode, fallback_reason } = await loadCurrentNflDataWithMode();
  const detail = nflTeamDetail(seed, c.req.param('teamId').toUpperCase());
  if (!detail) return c.json({ error: 'nfl_team_not_found' }, 404);
  return c.json({ ...detail, source_mode, fallback_reason });
});

nflRoutes.get('/player-stats/current', async (c) => {
  const { seed, source_mode, fallback_reason } = await loadCurrentNflDataWithMode();
  return c.json({
    ...groupNflTeams(seed),
    source_mode,
    fallback_reason,
    rows: seed.player_metrics,
  });
});

nflRoutes.get('/player-stats/current/:teamId', async (c) => {
  const { seed, source_mode, fallback_reason } = await loadCurrentNflDataWithMode();
  const detail = nflTeamDetail(seed, c.req.param('teamId').toUpperCase());
  if (!detail) return c.json({ error: 'nfl_team_not_found' }, 404);
  return c.json({
    snapshot: detail.snapshot,
    team: detail.team,
    rows: detail.player_metrics,
    source_refs: detail.source_refs,
    notes: detail.notes,
    source_mode,
    fallback_reason,
  });
});

nflRoutes.get('/coverage/current', async (c) => {
  return c.json(await buildNflCoverageMatrix());
});

nflRoutes.get('/coverage/current/:teamId', async (c) => {
  const detail = await buildNflCoverageTeam(c.req.param('teamId').toUpperCase());
  if (!detail.team) return c.json({ error: 'nfl_team_not_found' }, 404);
  return c.json(detail);
});

nflRoutes.get('/rules', async (c) => {
  const corpus = await loadNflRulesCorpus();
  const sections = corpus.rules.map((rule, index) => nflRuleToSection(corpus, rule, index));
  return c.json({
    document: nflRulesDocument(corpus),
    sections: sections.map(stripRuleBody),
  } satisfies CbaTocResponse);
});

nflRoutes.get('/rules/articles', async (c) => {
  const query = c.req.query('query') ?? '';
  const corpus = await loadNflRulesCorpus();
  const sections = corpus.rules
    .map((rule, index) => nflRuleToSection(corpus, rule, index))
    .map((section) => withRuleSearchSnippet(section, query))
    .filter((section) => !query.trim() || section.match_terms?.length);
  return c.json({
    query,
    sections: sections.map(stripRuleBody),
  } satisfies CbaSearchResponse);
});

nflRoutes.get('/rules/articles/:id', async (c) => {
  const id = decodeURIComponent(c.req.param('id'));
  const corpus = await loadNflRulesCorpus();
  const index = corpus.rules.findIndex((rule) => rule.rule_family === id);
  const rule = corpus.rules[index];
  if (!rule) return c.json({ error: 'nfl_rule_not_found' }, 404);
  const section = nflRuleToSection(corpus, rule, index);
  return c.json({
    section,
    chunks: [nflRuleToChunk(rule, index)],
  } satisfies CbaArticleResponse);
});

nflRoutes.post('/rules/chat', async (c) => {
  let body: CbaChatRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  if (!body.message || typeof body.message !== 'string' || !body.message.trim()) {
    return c.json({ error: 'message required' }, 400);
  }

  const corpus = await loadNflRulesCorpus();
  const contexts = nflRuleContexts(corpus.rules, body.message, body.activeArticleId ?? null);
  const citations = contexts.slice(0, 3).map(contextToCitation);
  const answerText = buildNflRulesAnswer(body.message, contexts);

  return streamSSE(c, async (stream) => {
    const writeEvent = (event: CbaChatStreamEvent) =>
      stream.writeSSE({ data: JSON.stringify(event) });

    await writeEvent({
      type: 'context',
      sections: contexts.map((context) => stripRuleBody(context.section)),
      citations,
      contexts: contexts.map((context) => context.payload),
    });

    for (const citation of citations) {
      await writeEvent({ type: 'citation', citation });
    }

    const first = contexts[0];
    if (first) {
      await writeEvent({ type: 'navigate', article_id: first.section.id, chunk_id: first.chunk.id });
    }

    if (/\b(we|our|giants|nyg|cap|contract|cut|restructure|extend|tag|trade)\b/i.test(body.message)) {
      await writeEvent({
        type: 'boundary',
        reason: 'team_specific_nfl_rules_question',
        action: 'open_analyze',
        question: body.message,
      });
    }

    for (const token of answerText.match(/\S+\s*/g) ?? []) {
      await writeEvent({ type: 'token', text: token });
    }
    await writeEvent({ type: 'done' });
  });
});

type NflRulesCorpus = Awaited<ReturnType<typeof loadNflRulesCorpus>>;

function nflRulesDocument(corpus: NflRulesCorpus): CbaDocument {
  return {
    id: corpus.document_id,
    title: corpus.title,
    source_url: corpus.source_url,
    effective_date: corpus.as_of_date,
    season_label: corpus.season,
    page_count: corpus.rules.length,
  };
}

function nflRuleToSection(corpus: NflRulesCorpus, rule: NflRuleRow, index: number): CbaSection {
  return {
    id: rule.rule_family,
    label: rule.title,
    body: nflRuleBody(rule),
    document_id: corpus.document_id,
    article: 'NFL Rules',
    section: rule.rule_family,
    section_number: null,
    page_start: null,
    page_end: null,
    sort_key: index,
    aliases: [
      rule.rule_family.replace(/_/g, ' '),
      rule.title,
      ...rule.summary.split(/\W+/).filter((term) => term.length > 6).slice(0, 8),
    ],
    source_url: rule.source_url,
  };
}

function nflRuleToChunk(rule: NflRuleRow, index: number): CbaChunk {
  return {
    id: `${rule.rule_family}:summary`,
    article_id: rule.rule_family,
    chunk_index: index + 1,
    body: nflRuleBody(rule),
    page_start: null,
    page_end: null,
  };
}

function nflRuleBody(rule: NflRuleRow): string {
  return [
    rule.summary,
    '',
    `Analysis use: ${rule.analysis_use}`,
    `Source note: ${rule.source_note}`,
  ].join('\n');
}

function stripRuleBody(section: CbaSection): CbaSection {
  return { ...section, body: '' };
}

function withRuleSearchSnippet(section: CbaSection, query: string): CbaSection {
  const terms = query.toLowerCase().split(/\W+/).filter((term) => term.length > 2);
  if (terms.length === 0) return section;
  const haystack = [
    section.label,
    section.section ?? '',
    section.body,
    ...section.aliases,
  ].join(' ').toLowerCase();
  const matches = terms.filter((term) => haystack.includes(term));
  return {
    ...section,
    snippet: matches.length ? clipText(section.body, 220) : null,
    match_terms: [...new Set(matches)],
  };
}

function nflRuleContexts(
  rules: NflRuleRow[],
  message: string,
  activeRuleFamily: string | null,
): Array<{ section: CbaSection; chunk: CbaChunk; payload: CbaSearchContextPayload }> {
  const corpus = {
    document_id: 'nfl-rules-demo-2026-offseason',
    title: '',
    season: '',
    as_of_date: '',
    source_url: '',
    source_name: '',
    retrieved_at: '',
    notes: [],
    schema_version: 1,
    rules,
  } satisfies NflRulesCorpus;
  return rules
    .map((rule, index) => {
      const section = nflRuleToSection(corpus, rule, index);
      const chunk = nflRuleToChunk(rule, index);
      const score = nflRuleScore(rule, message, activeRuleFamily);
      return {
        section,
        chunk,
        score,
        payload: {
          article_id: section.id,
          chunk_id: chunk.id,
          label: section.label,
          page_start: null,
          page_end: null,
          quote: rule.summary,
          score,
          match_kind: activeRuleFamily === rule.rule_family ? 'active_section' : 'metadata',
          support_level: score >= 8 ? 'strong' : score >= 4 ? 'medium' : 'weak',
        } satisfies CbaSearchContextPayload,
      };
    })
    .filter((context) => context.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function nflRuleScore(rule: NflRuleRow, message: string, activeRuleFamily: string | null): number {
  const text = message.toLowerCase();
  let score = activeRuleFamily === rule.rule_family ? 5 : 0;
  const terms = [
    ...rule.rule_family.split('_'),
    ...rule.title.toLowerCase().split(/\W+/),
    ...rule.analysis_use.toLowerCase().split(/\W+/),
  ].filter((term) => term.length > 3);
  for (const term of new Set(terms)) {
    if (text.includes(term)) score += 1;
  }
  if (/restructure|convert|bonus/.test(text) && rule.rule_family === 'restructure_conversion') score += 7;
  if (/post[- ]?june|dead money|release|cut/.test(text) && rule.rule_family === 'post_june_1_accounting') score += 7;
  if (/franchise|transition|tag|tender/.test(text) && rule.rule_family === 'franchise_transition_tag') score += 7;
  if (/extend|extension|new money|guarantee/.test(text) && rule.rule_family === 'extensions') score += 7;
  if (/cap|room|top[- ]?51|accounting/.test(text) && rule.rule_family === 'salary_cap_accounting') score += 5;
  if (/trade|pick/.test(text) && rule.rule_family === 'trades') score += 5;
  return score;
}

function contextToCitation(context: { section: CbaSection; chunk: CbaChunk; payload: CbaSearchContextPayload }): CbaCitation {
  return {
    article_id: context.section.id,
    chunk_id: context.chunk.id,
    label: context.section.label,
    page_start: null,
    page_end: null,
    quote: context.payload.quote,
  };
}

function buildNflRulesAnswer(
  message: string,
  contexts: Array<{ section: CbaSection; payload: CbaSearchContextPayload }>,
): string {
  if (contexts.length === 0) {
    return 'I do not have a strong NFL rule match in the loaded static corpus. Open Analyze for a team-specific answer, and caveat the missing rule coverage.';
  }
  const labels = contexts.slice(0, 3).map((context) => context.section.label).join(', ');
  const boundary = /\b(we|our|giants|nyg|cap|contract|cut|restructure|extend|tag|trade)\b/i.test(message)
    ? ' For Giants or player-specific cap decisions, open Analyze so the answer can combine these rules with app cap rows.'
    : '';
  return `Relevant loaded NFL rule families: ${labels}.${boundary}`;
}

function clipText(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length > maxChars ? `${normalized.slice(0, maxChars - 3)}...` : normalized;
}
