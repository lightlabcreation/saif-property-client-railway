const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const phone = '4389512815';
  const users = await prisma.user.findMany({
    where: {
      phone: { contains: phone }
    }
  });
  console.log(`Users matching ${phone}:`, JSON.stringify(users, null, 2));

  const allWithPhone = await prisma.user.findMany({
    where: { NOT: { phone: null } },
    select: { id: true, name: true, phone: true }
  });
  console.log('All users with phones:', JSON.stringify(allWithPhone, null, 2));

  const lastMessages = await prisma.message.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' },
    include: { sender: true, receiver: true }
  });
  console.log('Last 5 messages:', JSON.stringify(lastMessages, null, 2));

  await prisma.$disconnect();
}

check();
