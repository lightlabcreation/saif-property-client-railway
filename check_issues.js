
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('--- Checking Units 101 and 102 (Building 82) ---');
    const units82 = await prisma.unit.findMany({
        where: {
            unitNumber: { in: ['101', '102'] },
            property: { civicNumber: '82' }
        },
        include: {
            bedroomsList: true,
            leases: {
                where: { status: { in: ['Active', 'DRAFT', 'Expired'] } },
                include: { tenant: true }
            }
        }
    });

    units82.forEach(u => {
        console.log(`Unit ${u.unitNumber} (ID: ${u.id}): Status = ${u.status}, RentalMode = ${u.rentalMode}`);
        console.log('Bedrooms:');
        u.bedroomsList.forEach(b => {
            console.log(`  - Bedroom ${b.bedroomNumber} (ID: ${b.id}): Status = ${b.status}`);
        });
        console.log('Leases:');
        u.leases.forEach(l => {
            console.log(`  - Lease ID: ${l.id}, Status: ${l.status}, Type: ${l.leaseType}, Tenant: ${l.tenant.name}`);
        });
    });

    console.log('\n--- Checking Unit 202 (Building 88) ---');
    const unit202 = await prisma.unit.findFirst({
        where: {
            unitNumber: '202',
            property: { civicNumber: '88' }
        },
        include: {
            bedroomsList: true
        }
    });

    if (unit202) {
        console.log(`Unit 202 (ID: ${unit202.id}): Status = ${unit202.status}`);
        console.log('Bedrooms:');
        unit202.bedroomsList.forEach(b => {
            console.log(`  - Bedroom ${b.bedroomNumber} (ID: ${b.id}): Status = ${b.status}, RoomNumber = ${b.roomNumber}`);
        });
    } else {
        console.log('Unit 202 not found.');
    }

    console.log('\n--- Checking Buildings and Unit Counts ---');
    const properties = await prisma.property.findMany({
        include: { _count: { select: { units: true } } }
    });
    properties.forEach(p => {
        console.log(`Property: ${p.name}, Civic: ${p.civicNumber}, Units: ${p._count.units}`);
    });
}

main()
    .catch(e => console.error(e))
    .finally(() => prisma.$disconnect());
