import 'dotenv/config';
import { loadNflDemoSeed, seedNflDemoData } from '../nfl_data/seed.js';

async function main() {
  console.log('▶ seeding NFL roster/cap snapshots…');
  const seed = await loadNflDemoSeed();
  const summary = await seedNflDemoData(seed);
  console.log(
    `  · NFL data ${summary.as_of_date}: ` +
    `${summary.team_count} teams / ${summary.roster_row_count} roster rows / ` +
    `${summary.cap_row_count} cap rows / ${summary.source_needed_cap_row_count} source-needed cap rows`,
  );
  console.log('✓ NFL roster/cap seed complete.');
}

main().catch((err) => {
  console.error('✗ NFL seed failed:', err);
  process.exit(1);
});
