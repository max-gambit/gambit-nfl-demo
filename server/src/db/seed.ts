import 'dotenv/config';
import { db } from './client.js';
import {
  clearGeneratedUserContent,
  loadNbaRosterSeed,
  seedNbaRosters,
} from '../nba_rosters/seed.js';
import {
  loadNbaCapSheetSeed,
  seedNbaCapSheets,
} from '../nba_cap_sheets/seed.js';
import {
  loadNbaPlayerStatsSeed,
  seedNbaPlayerStats,
} from '../nba_player_stats/seed.js';
import { loadNflDemoSeed, seedNflDemoData } from '../nfl_data/seed.js';
import { loadCbaCorpusSeed, seedCbaCorpus } from '../cba/seed.js';

// Baseline seed — runs on every fresh DB.
//
// Clears generated user-facing content, preserves reference infrastructure,
// then loads the CBA corpus and the official NBA roster snapshot.
//
// To populate sample data for development, run `npm run seed:demo` instead.

async function main() {
  console.log('▶ seeding Supabase baseline…');

  const cleanup = await clearGeneratedUserContent();
  console.log('  · cleared generated content:', cleanup.deleted);
  if (cleanup.storage_objects > 0) {
    console.log(`  · requested deletion for ${cleanup.storage_objects} artifact storage object(s)`);
  }

  const cbaSeed = await loadCbaCorpusSeed();
  const cbaSummary = await seedCbaCorpus(cbaSeed);
  console.log(`  · CBA corpus ${cbaSummary.document_id}: ${cbaSummary.section_count} sections / ${cbaSummary.chunk_count} chunks`);

  const rosterSeed = await loadNbaRosterSeed();
  const rosterSummary = await seedNbaRosters(rosterSeed);
  console.log(
    `  · NBA rosters ${rosterSummary.as_of_date}: ` +
    `${rosterSummary.team_count} teams / ${rosterSummary.entry_count} official roster entries`,
  );

  const capSheetSeed = await loadNbaCapSheetSeed();
  const capSheetSummary = await seedNbaCapSheets(capSheetSeed);
  console.log(
    `  · NBA cap sheets ${capSheetSummary.as_of_date}: ` +
    `${capSheetSummary.team_count} teams / ${capSheetSummary.player_row_count} player salary rows`,
  );

  const playerStatsSeed = await loadNbaPlayerStatsSeed();
  const playerStatsSummary = await seedNbaPlayerStats(playerStatsSeed);
  console.log(
    `  · NBA player stats ${playerStatsSummary.as_of_date}: ` +
    `${playerStatsSummary.team_count} teams / ${playerStatsSummary.row_count} rows ` +
    `(${playerStatsSummary.matched_player_count} roster-linked, ${playerStatsSummary.unmatched_player_count} stats-only)`,
  );

  const nflSeed = await loadNflDemoSeed();
  const nflSummary = await seedNflDemoData(nflSeed);
  console.log(
    `  · NFL data ${nflSummary.as_of_date}: ` +
    `${nflSummary.team_count} teams / ${nflSummary.roster_row_count} roster rows / ` +
    `${nflSummary.cap_row_count} cap rows / ${nflSummary.source_needed_cap_row_count} source-needed cap rows`,
  );

  console.log('✓ baseline seed complete. The app will load with zero sessions / zero briefs and seeded NBA + NFL reference databases.');
  console.log('  Run `npm run seed:demo` to populate sample sessions and briefs.');
}

main().catch((err) => {
  console.error('✗ seed failed:', err);
  process.exit(1);
});
