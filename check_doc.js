const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
    try {
        const doc = await prisma.document.findUnique({ where: { id: 1 } });
        console.log('Document 1:', doc);
    } catch (e) {
        console.error('Error:', e);
    } finally {
        await prisma.$disconnect();
    }
}

check();
