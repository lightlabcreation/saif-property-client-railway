const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const lastOutbounds = await prisma.message.findMany({
    where: { direction: 'OUTBOUND' },
    take: 10,
    orderBy: { createdAt: 'desc' },
    include: { receiver: { select: { id: true, name: true, phone: true } } }
  });
  console.log('Last Outbound Messages:', JSON.stringify(lastOutbounds, null, 2));

  await prisma.$disconnect();
}

check();
