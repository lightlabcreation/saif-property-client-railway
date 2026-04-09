const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('--- Initializing Unit Readiness Timeline Settings ---');

  const settings = [
    { key: 'gc_to_deficiencies', days: 5 },
    { key: 'deficiencies_to_cleaned', days: 3 },
    { key: 'cleaned_to_ffe', days: 7 },
    { key: 'ffe_to_ose', days: 2 },
    { key: 'ose_to_final', days: 1 },
    { key: 'final_to_ready', days: 0 }
  ];

  for (const s of settings) {
    await prisma.timelineSetting.upsert({
      where: { key: s.key },
      update: { days: s.days },
      create: { key: s.key, days: s.days }
    });
    console.log(`Setting created: ${s.key} -> ${s.days} days`);
  }

  console.log('--- Done! ---');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
