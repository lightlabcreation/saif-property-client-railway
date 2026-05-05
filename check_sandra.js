const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkSandra() {
    const tenant = await prisma.user.findFirst({
        where: { name: { contains: 'Sandra' } },
        include: {
            refundAdjustments: true,
            leases: true
        }
    });

    if (!tenant) {
        console.log('Sandra not found');
        return;
    }

    console.log('Tenant:', tenant.name, '(ID:', tenant.id, ')');
    console.log('Refund Adjustments:', JSON.stringify(tenant.refundAdjustments, null, 2));
    console.log('Leases:', JSON.stringify(tenant.leases.map(l => ({ id: l.id, unitId: l.unitId, status: l.status, endDate: l.endDate })), null, 2));

    // Also check invoices
    const invoices = await prisma.invoice.findMany({
        where: { tenantId: tenant.id, OR: [{ category: 'SECURITY_DEPOSIT' }, { description: { contains: 'Security Deposit' } }] }
    });
    console.log('Security Deposit Invoices:', JSON.stringify(invoices.map(i => ({ id: i.id, unitId: i.unitId, paidAmount: i.paidAmount, leaseId: i.leaseId })), null, 2));
}

checkSandra()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
