import 'dotenv/config';
import {
  loadReviewedNflTransactionSnapshot,
  seedNflTransactionMarketData,
} from '../nfl_transactions/seed.js';

async function main(): Promise<void> {
  const { snapshot, manifest } = await loadReviewedNflTransactionSnapshot();
  const result = await seedNflTransactionMarketData(snapshot, manifest);
  console.log(JSON.stringify({
    schema: 'nfl_transaction_seed.v1',
    status: 'pass',
    snapshot_id: result.snapshot_id,
    inserted_counts: result.inserted_counts,
  }, null, 2));
}

void main().catch((error) => {
  console.error(JSON.stringify({
    schema: 'nfl_transaction_seed.v1',
    status: 'fail',
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
});
