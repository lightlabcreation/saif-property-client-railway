const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkAllRefunds() {
    const refunds = await prisma.refundAdjustment.findMany({
        include: { tenant: true, unit: true }
    });

    console.log('All Refund Adjustments:', JSON.stringify(refunds.map(r => ({
        requestId: r.requestId,
        tenant: r.tenant?.name,
        unit: r.unit?.name,
        status: r.status,
        tenantId: r.tenantId
    })), null, 2));
}

checkAllRefunds()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
