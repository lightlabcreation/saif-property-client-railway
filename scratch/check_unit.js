const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const unit = await prisma.unit.findUnique({
        where: { id: 60 },
        select: { id: true, unitNumber: true, status: true, availability_status: true, unit_status: true, reserved_flag: true }
    });
    console.log(JSON.stringify(unit, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
