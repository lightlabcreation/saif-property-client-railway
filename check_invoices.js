const prisma = require('./src/config/prisma');

async function check() {
  const invoices = await prisma.invoice.findMany({
    where: { 
      month: { contains: 'March 2026' }
    },
    include: { unit: true }
  });
  console.log(JSON.stringify(invoices, null, 2));
}

check().finally(() => process.exit());
