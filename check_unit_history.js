const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function showDetailedHistory() {
    try {
        const unit = await prisma.unit.findFirst({
            where: { id: 14 },
            include: {
                property: true,
                leases: {
                    include: { tenant: true }
                }
            }
        });

        if (!unit) {
            console.log('Unit not found');
            return;
        }

        console.log('--- Database Dump for Unit A-101 (ID 14) ---');
        console.log(JSON.stringify(unit, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

showDetailedHistory();
