import 'dotenv/config';
import { loadNflDemoSeed, seedNflDemoData } from '../nfl_data/seed.js';
import { loadReviewedNflTransactionSnapshot, seedNflTransactionMarketData } from '../nfl_transactions/seed.js';
import { seedNygDemoWorkspace } from './seed-nfl-demo-workspace.js';

// Baseline seed — runs on every fresh DB.
//
// Upserts the owned public NFL datasets and Giants supporting workspace.
// User-created and legacy sessions/projects are never deleted by this seed.

async function main() {
  console.log('▶ seeding Supabase baseline…');

  const nflSeed = await loadNflDemoSeed();
  const nflSummary = await seedNflDemoData(nflSeed);
  console.log(
    `  · NFL data ${nflSummary.as_of_date}: ` +
    `${nflSummary.team_count} teams / ${nflSummary.roster_row_count} roster rows / ` +
    `${nflSummary.cap_row_count} cap rows / ${nflSummary.source_needed_cap_row_count} source-needed cap rows`,
  );
  const transactionSource = await loadReviewedNflTransactionSnapshot();
  const transactionSummary = await seedNflTransactionMarketData(
    transactionSource.snapshot,
    transactionSource.manifest,
  );
  console.log(
    `  · NFL transaction market ${transactionSummary.snapshot_id}: ` +
    `${transactionSummary.seed_status}`,
  );
  await seedNygDemoWorkspace();
  console.log('  · Giants supporting workspace upserted in nyg-demo scope');

  console.log('✓ safe NFL baseline seed complete. Existing sessions and projects were preserved.');
}

main().catch((err) => {
  console.error('✗ seed failed:', err);
  process.exit(1);
});
