const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function showVehicleColumns() {
    try {
        const row = await prisma.vehicle.findFirst();
        console.log('--- Vehicle Table Row Column Design Format ---');
        console.log(JSON.stringify(row, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

showVehicleColumns();
