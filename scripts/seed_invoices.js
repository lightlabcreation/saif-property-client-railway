const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function seed() {
    console.log('--- SEEDING INVOICES FOR DEMO TENANT ---');
    
    // Find the demo tenant
    const tenant = await prisma.user.findUnique({
        where: { email: 'tenant@example.com' },
        include: { leases: { where: { status: 'Active' }, include: { unit: true } } }
    });

    if (!tenant) {
        console.error('Demo tenant NOT found! Seed user first.');
        return;
    }

    if (tenant.leases.length === 0) {
        console.error('Demo tenant has NO Active lease! Use Active (capital A). Checking all leases...');
        const allLeases = await prisma.lease.findMany({ where: { tenantId: tenant.id } });
        console.log('All leases found:', allLeases.map(l => l.status));
        
        // If there's an ACTIVE one, fix it to Active
        for (const l of allLeases) {
            if (l.status.toLowerCase() === 'active') {
                await prisma.lease.update({ where: { id: l.id }, data: { status: 'Active' } });
                console.log(`Updated lease ${l.id} status to 'Active'`);
            }
        }
    }

    const lease = tenant.leases[0] || (await prisma.lease.findFirst({ where: { tenantId: tenant.id } }));
    
    if (!lease) {
        console.error('NO lease found for tenant even after check.');
        return;
    }

    // Create some invoices
    const invoices = [
        {
            invoiceNo: 'INV-2026-001',
            tenantId: tenant.id,
            leaseId: lease.id,
            unitId: lease.unitId,
            month: 'January 2026',
            amount: 1450.00,
            rent: 1450.00,
            serviceFees: 0.00,
            status: 'Paid',
            balanceDue: 0.00,
            dueDate: new Date('2026-01-01'),
            createdAt: new Date('2026-01-01')
        },
        {
            invoiceNo: 'INV-2026-002',
            tenantId: tenant.id,
            leaseId: lease.id,
            unitId: lease.unitId,
            month: 'February 2026',
            amount: 1450.00,
            rent: 1450.00,
            serviceFees: 0.00,
            status: 'Unpaid',
            balanceDue: 1450.00,
            dueDate: new Date('2026-02-01'),
            createdAt: new Date('2026-02-01')
        }
    ];

    for (const inv of invoices) {
        const existing = await prisma.invoice.findFirst({ where: { invoiceNo: inv.invoiceNo } });
        if (!existing) {
            await prisma.invoice.create({ data: inv });
            console.log(`Created invoice ${inv.invoiceNo}`);
        } else {
            console.log(`Invoice ${inv.invoiceNo} already exists`);
        }
    }

    console.log('--- SEEDING COMPLETE ---');
}

seed()
    .catch(e => console.error(e))
    .finally(() => prisma.$disconnect());
