const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const property = await prisma.property.findFirst({
        where: { name: 'ABC' },
        include: {
            units: {
                include: {
                    leases: {
                        where: { status: 'Active' },
                        include: { residents: true, tenant: true }
                    }
                }
            }
        }
    });

    if (!property) {
        console.log("Property 'ABC' not found.");
        process.exit(1);
    }

    console.log(`Property: ${property.name} (ID: ${property.id})`);
    console.log(`Units: ${property.units.length}`);

    let totalActiveLeases = 0;
    let totalResidentsCount = 0;

    property.units.forEach(u => {
        console.log(`  Unit: ${u.unitNumber} (Mode: ${u.rentalMode}, Status: ${u.status}, ID: ${u.id})`);
        u.leases.forEach(l => {
            totalActiveLeases++;
            const resCount = 1 + (l.residents ? l.residents.length : 0);
            totalResidentsCount += resCount;
            console.log(`    Lease: ${l.id} Status: ${l.status}`);
            console.log(`      Tenant: ${l.tenant.name} (${l.tenant.firstName} ${l.tenant.lastName}) - Type: ${l.tenant.type}`);
            console.log(`      Additional Residents: ${l.residents.length}`);
            console.log(`      Total Count for this lease: ${resCount}`);
        });
    });

    console.log(`\nFinal Stats for Property ABC:`);
    console.log(`Active Leases: ${totalActiveLeases}`);
    console.log(`Total Resident Count (Tenants): ${totalResidentsCount}`);
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
