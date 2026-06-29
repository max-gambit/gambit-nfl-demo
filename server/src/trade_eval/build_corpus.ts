import {
  DEFAULT_TRADE_EVAL_OUT_DIR,
  buildTradeEvalArtifacts,
  mergeTradeEvalLabels,
  writeTradeEvalArtifacts,
} from './corpus.js';
import { loadNbaCapSheetSeed } from '../nba_cap_sheets/seed.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  parseTradeEvalLabelFixture,
  parseTradeEvalScenarioFixture,
  tradeEvalScenarioSignature,
  type TradeEvalLabel,
} from '@shared/tradeEval';

const outDirArg = process.argv.find((arg) => arg.startsWith('--out-dir='));
const outDir = outDirArg?.slice('--out-dir='.length) || DEFAULT_TRADE_EVAL_OUT_DIR;

const seed = await loadNbaCapSheetSeed();
const artifacts = buildTradeEvalArtifacts(seed);
artifacts.labels.labels = await loadExistingLabels(outDir)
  .then((existingLabels) => existingLabels == null
    ? artifacts.labels.labels
    : mergeTradeEvalLabels(artifacts.labels.labels, existingLabels));
await writeTradeEvalArtifacts(artifacts, outDir);

console.log([
  `Wrote NBA trade eval corpus to ${outDir}`,
  `scenarios=${artifacts.scenarios.scenarios.length}`,
  `prompts=${artifacts.prompts.prompts.length}`,
  `labels=${artifacts.labels.labels.length}`,
  `queue_items=${artifacts.labelingQueue.items.length}`,
].join(' '));

async function loadExistingLabels(outDirPath: string): Promise<TradeEvalLabel[] | null> {
  try {
    const raw = await readFile(join(outDirPath, 'labels.v0.json'), 'utf8');
    const labels = parseTradeEvalLabelFixture(JSON.parse(raw)).labels;
    const existingSignatures = await loadExistingScenarioSignatures(outDirPath);
    return labels.map((label) => ({
      ...label,
      scenario_signature: label.scenario_signature
        ?? existingSignatures.get(label.scenario_id)
        ?? null,
    }));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function loadExistingScenarioSignatures(outDirPath: string): Promise<Map<string, string>> {
  try {
    const raw = await readFile(join(outDirPath, 'scenarios.v0.json'), 'utf8');
    const fixture = parseTradeEvalScenarioFixture(JSON.parse(raw));
    return new Map(fixture.scenarios.map((scenario) => [scenario.id, tradeEvalScenarioSignature(scenario)]));
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return new Map();
    }
    throw error;
  }
}
