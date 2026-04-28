const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function listInsurances() {
    try {
        const list = await prisma.insurance.findMany();
        console.log('Total insurance records:', list.length);
        if (list.length > 0) {
            console.log('Sample record fields:', Object.keys(list[0]));
            // Let's inspect the exact values of the first record
            console.log('First Record detail:', JSON.stringify(list[0], null, 2));
        }
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

listInsurances();
