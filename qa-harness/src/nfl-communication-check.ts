import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import { nflCommunicationIssues } from '../../server/src/nfl_conversation/communication.js';

// Opt-in live regression: read existing evidence, generate answers, write QA
// artifacts only. No application conversations or source records are changed.
if (!process.argv.includes('--live')) throw new Error('Use --live to run the three model-backed communication checks.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const db = JSON.parse(execFileSync(resolve(root, 'node_modules/.bin/supabase'), ['status', '--output', 'json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
if (!['localhost', '127.0.0.1'].includes(new URL(db.API_URL).hostname)) throw new Error('These checks require the existing local database.');
const env = dotenv.parse(await readFile(resolve(root, 'server/.env')));
for (const [key, value] of Object.entries(env)) process.env[key] ??= value;
process.env.SUPABASE_URL = db.API_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = db.SERVICE_ROLE_KEY;
const { buildNflAiAnswer } = await import(pathToFileURL(resolve(root, 'server/src/nfl_facts/ai_answer.ts')).href);
const cases = [
  { id: 'verification', maxWords: 200, question: 'What must we verify before executing a $2 million conversion of Paulson Adebo’s 2026 salary under his existing contract?' },
  { id: 'funding', maxWords: 300, question: 'Use Meyers’s saved hypothetical acquisition contract. We have $3 million of cap budget, need to retain a $1 million reserve, and must protect Burns and Thomas. What is the least salary conversion needed, and what does it cost us this year and next?' },
  { id: 'scouting', maxWords: 240, question: 'Compare Darius Slayton and Darnell Mooney for more receiving work with Nabers unavailable in this scenario. Who should get the first look, why, and what should our coaches verify?' },
];
const caseIndex = process.argv.indexOf('--case');
const selected = caseIndex < 0 ? cases : cases.filter(item => process.argv[caseIndex + 1]?.split(',').includes(item.id));
if (!selected.length) throw new Error('No matching communication cases.');
const sessionIndex = process.argv.indexOf('--session-id');
const sessionId = sessionIndex >= 0 ? process.argv[sessionIndex + 1] : undefined;
if (selected.some(item => item.id === 'funding') && !sessionId) throw new Error('Funding checks require --session-id for an existing Giants conversation to scope saved-contract access.');
const out = resolve(root, 'test-results/analyst-restoration/communication-regression');
await mkdir(out, { recursive: true });
const results = await Promise.all(selected.map(async item => {
  const result = await buildNflAiAnswer(item.question, { deadlineMs: 180000, sessionId });
  const words = result.body.answer.trim().split(/\s+/).length;
  const issues = nflCommunicationIssues(item.question, result.body.answer);
  const sourceRefs = new Set(result.sources.map((source: { ref_index: number }) => source.ref_index));
  const missingRefs = (result.body.answer_paragraphs ?? []).flatMap((paragraph: { source_refs: number[] }) => paragraph.source_refs).filter((ref: number) => !sourceRefs.has(ref));
  const passed = result.body.ai_analysis?.outcome === 'complete' && result.body.ai_analysis?.grounding_checked === true && !issues.length && !missingRefs.length && words <= item.maxWords;
  const record = { ...item, passed, words, issues, missingRefs, result };
  await writeFile(resolve(out, item.id + '.json'), JSON.stringify(record, null, 2));
  console.log(JSON.stringify({ id: item.id, passed, words, issues, missingRefs, elapsed_ms: result.body.ai_analysis?.elapsed_ms }));
  return record;
}));
if (results.some(result => !result.passed)) process.exitCode = 1;
