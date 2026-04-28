const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkUnitData() {
    try {
        const unit = await prisma.unit.findFirst({
            where: {
                OR: [
                    { unitNumber: 'A-101' },
                    { name: { contains: 'A-101' } }
                ]
            }
        });

        if (!unit) {
            console.log('Unit A-101 not found!');
            return;
        }

        console.log('--- Unit Details ---');
        console.log(`ID: ${unit.id}`);
        console.log(`Unit Number/Name: ${unit.unitNumber || unit.name}`);
        console.log(`Rent Amount (Potential Rent): $${unit.rentAmount}`);
        console.log(`Status: ${unit.status}`);
        console.log(`Rental Mode: ${unit.rentalMode}`);
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

checkUnitData();
