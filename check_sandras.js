const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkSandras() {
    const tenants = await prisma.user.findMany({
        where: { name: { contains: 'Sandra' } }
    });

    console.log('All Sandras:', JSON.stringify(tenants.map(t => ({ id: t.id, name: t.name })), null, 2));
}

checkSandras()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
