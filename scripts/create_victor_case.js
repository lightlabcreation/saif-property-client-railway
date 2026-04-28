const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function createVictorTestCase() {
    console.log('--- CREATING EXACT VICTOR BASSETTI TEST CASE ---');

    try {
        // 1. Create the Victor Tenant
        const victor = await prisma.user.upsert({
            where: { email: 'victor_test@example.com' },
            update: { role: 'TENANT' },
            create: {
                firstName: 'Victor',
                lastName: 'Test-Case',
                email: 'victor_test@example.com',
                phone: '999-999-9999',
                role: 'TENANT'
            }
        });

        // 2. Find or Create the Unit (86-102)
        let property = await prisma.property.findFirst();
        if (!property) {
             property = await prisma.property.create({
                data: {
                    name: 'Victor Building',
                    address: '86 Example St',
                    city: 'Montreal',
                    status: 'Active'
                }
             });
        }

        const unit = await prisma.unit.upsert({
            where: { id: 86102 }, // Using a fixed ID for uniqueness or finding it
            update: { unitNumber: '86-102' },
            create: {
                id: 86102,
                name: '86-102',
                unitNumber: '86-102',
                propertyId: property.id,
                status: 'Occupied',
                rentAmount: 925
            }
        }).catch(async () => {
            // Fallback if ID exists
            return await prisma.unit.findFirst({ where: { unitNumber: '86-102' } });
        });

        // 3. Create the PAID Deposit Invoice ($925)
        await prisma.invoice.create({
            data: {
                invoiceNo: `INV-VICTOR-SD-${Date.now()}`,
                tenantId: victor.id,
                unitId: (unit || property).id,
                category: 'SECURITY_DEPOSIT',
                amount: 925,
                paidAmount: 925,
                balanceDue: 0,
                status: 'paid',
                month: 'April 2026',
                rent: 0,
                dueDate: new Date(),
                description: 'Initial Security Deposit (Liability)'
            }
        });

        // 4. Create the UNPAID Rent Invoice ($925)
        await prisma.invoice.create({
            data: {
                invoiceNo: `INV-VICTOR-RENT-${Date.now()}`,
                tenantId: victor.id,
                unitId: (unit || property).id,
                category: 'RENT',
                amount: 925,
                paidAmount: 0,
                balanceDue: 925,
                status: 'unpaid',
                month: 'April 2026',
                rent: 925,
                dueDate: new Date(),
                description: 'Outstanding Rent Debt'
            }
        });

        console.log('\n--- DATA CREATED ---');
        console.log('Tenant: Victor Test-Case');
        console.log('Unit: 86-102');
        console.log('Deposit Paid: $925.00');
        console.log('Rent Debt:    $925.00');
        console.log('\nGO TO DASHBOARD: You will see your Deposit total has increased by $925.');

    } catch (err) {
        console.error('Error creating Victor test case:', err);
    } finally {
        await prisma.$disconnect();
    }
}

createVictorTestCase();
