import 'dotenv/config';
import { loadCbaCorpusSeed, seedCbaCorpus } from '../cba/seed.js';

async function main() {
  console.log('▶ seeding CBA corpus...');
  const seed = await loadCbaCorpusSeed();
  const summary = await seedCbaCorpus(seed);
  console.log(`✓ CBA corpus ${summary.document_id}: ${summary.section_count} sections / ${summary.chunk_count} chunks`);
}

main().catch((err) => {
  console.error('✗ CBA seed failed:', err);
  process.exit(1);
});
