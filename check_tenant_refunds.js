const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkTenantRefunds() {
    const tenantId = 49; // Sandra's ID
    const refunds = await prisma.refundAdjustment.findMany({
        where: { tenantId }
    });

    console.log('Refunds for Tenant 49:', JSON.stringify(refunds, null, 2));
}

checkTenantRefunds()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
