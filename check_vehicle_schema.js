const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkVehicle() {
    try {
        const v = await prisma.vehicle.findFirst();
        console.log('Vehicle full object:', JSON.stringify(v, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

checkVehicle();
