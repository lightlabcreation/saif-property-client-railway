const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkTenantInsurance() {
    try {
        // Let's find any Insurance record with uploadedDocumentId setup
        const ins = await prisma.insurance.findFirst({
            where: { uploadedDocumentId: { not: null } },
            include: { document: true }
        });
        
        if (!ins) {
            console.log('No insurance record with document found!');
            return;
        }

        console.log('Insurance:', JSON.stringify(ins, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

checkTenantInsurance();
