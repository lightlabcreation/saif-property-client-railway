const prisma = require('./src/config/prisma');

async function check() {
  const refunds = await prisma.refundAdjustment.findMany({
    where: { status: 'Completed' },
    include: { unit: true }
  });
  console.log(JSON.stringify(refunds, null, 2));
}

check().finally(() => process.exit());
