const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
    // Check leases for Ping Yang (27) and Runhuai Wan (30)
    const leases = await prisma.lease.findMany({
        where: {
            OR: [
                { tenantId: { in: [27, 30] } },
                { residents: { some: { id: { in: [27, 30] } } } }
            ]
        },
        include: {
            tenant: { select: { id: true, name: true, firstName: true, lastName: true } },
            residents: { select: { id: true, name: true, firstName: true, lastName: true } },
            unit: { include: { property: true } }
        }
    });

    console.log('=== Leases found for tenantId 27 (Ping Yang) & 30 (Runhuai Wan) ===');
    console.log('Total:', leases.length);
    console.log(JSON.stringify(leases, null, 2));

    // Also check if they exist as users at all
    const users = await prisma.user.findMany({
        where: { id: { in: [27, 30] } },
        select: { id: true, name: true, firstName: true, lastName: true, leaseId: true, role: true, type: true }
    });
    console.log('\n=== User records for IDs 27 & 30 ===');
    console.log(JSON.stringify(users, null, 2));

    await prisma.$disconnect();
}

check().catch(e => { console.error(e); process.exit(1); });
