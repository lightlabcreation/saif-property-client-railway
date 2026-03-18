const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkLease() {
    try {
        const lease = await prisma.lease.findFirst({
            where: { tenantId: 11, status: 'Active' },
            include: { unit: true }
        });

        if (lease) {
            console.log('--- Active Lease Found ---');
            console.log(`Lease ID: ${lease.id}`);
            console.log(`Unit: ${lease.unit?.unitNumber}`);
            console.log(`Status: ${lease.status}`);
            console.log(`End Date: ${lease.endDate}`);
        } else {
            console.log('No Active Lease found for tenantId 11!');
        }
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

checkLease();
