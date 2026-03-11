const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const property = await prisma.property.findFirst({
        where: { name: 'ABC' },
        include: {
            units: {
                include: {
                    bedroomsList: true,
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
    property.units.forEach(u => {
        console.log(`\nUnit: ${u.unitNumber} (Mode: ${u.rentalMode}, Status: ${u.status}, ID: ${u.id})`);
        console.log(`Bedrooms: ${u.bedroomsList.length}`);
        u.bedroomsList.forEach(b => {
            console.log(`  Bedroom ${b.roomNumber}: ${b.status}`);
        });
        console.log(`Active Leases: ${u.leases.length}`);
        u.leases.forEach(l => {
            console.log(`  - Lease ID: ${l.id} for Tenant ${l.tenant.name}`);
        });
    });
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
