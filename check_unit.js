const prisma = require('./src/config/prisma');
async function check() {
  const unit = await prisma.unit.findFirst({
    where: { unitNumber: '93-401' },
    include: { property: true }
  });
  console.log('Unit Data:', JSON.stringify(unit, null, 2));
  process.exit(0);
}
check();
