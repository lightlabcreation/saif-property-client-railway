const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkRefund() {
    const refund = await prisma.refundAdjustment.findUnique({
        where: { requestId: 'RA-00023' },
        include: { tenant: true }
    });

    console.log('Refund RA-00023:', JSON.stringify(refund, null, 2));
}

checkRefund()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
