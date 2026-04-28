const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const allWithPhone = await prisma.user.findMany({
    where: { NOT: { phone: null } },
    select: { id: true, name: true, phone: true }
  });
  console.log('All users with phones:', JSON.stringify(allWithPhone, null, 2));

  // Also check messages for any inbound
  const inbounds = await prisma.message.findMany({
    where: { direction: 'INBOUND' },
    take: 5
  });
  console.log('Recent Inbounds:', JSON.stringify(inbounds, null, 2));

  await prisma.$disconnect();
}

check();
