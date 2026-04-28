const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🚀 Starting Seed for Security Deposit Test...');

  // 1. Create a Unit
  const unit = await prisma.unit.create({
    data: {
      name: 'Unit A1-Test',
      property: {
        create: {
          name: 'Test Property',
          address: '123 Test Avenue',
        }
      },
      rentAmount: 1200,
    }
  });

  // 2. Create a Tenant
  const tenant = await prisma.user.create({
    data: {
      email: 'test_tenant@example.com',
      name: 'Test Allocation Tenant',
      role: 'TENANT',
      unitId: unit.id,
    }
  });

  // 3. Create an Ended Lease
  const lease = await prisma.lease.create({
    data: {
      tenantId: tenant.id,
      unitId: unit.id,
      status: 'Ended', // This is critical for the calculation to work
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-03-26'), // Ended yesterday
      securityDeposit: 1000,
    }
  });

  // 4. Create Paid Security Deposit Invoice (Foundational Balance)
  await prisma.invoice.create({
    data: {
      invoiceNo: 'INV-TEST-SD',
      tenantId: tenant.id,
      unitId: unit.id,
      month: 'March',
      amount: 1000,
      rent: 0,
      category: 'SECURITY_DEPOSIT',
      status: 'paid', // Must be paid to be "available"
      paidAmount: 1000,
      balanceDue: 0,
      description: 'Paid Security Deposit',
      dueDate: new Date(),
    }
  });

  // 5. Create Outstanding SERVICE Fee Invoice (Priority 1)
  await prisma.invoice.create({
    data: {
      invoiceNo: 'INV-TEST-SERVICE',
      tenantId: tenant.id,
      unitId: unit.id,
      month: 'March',
      amount: 300,
      rent: 0,
      category: 'SERVICE',
      status: 'unpaid',
      paidAmount: 0,
      balanceDue: 300,
      description: 'Cleaning & Repairs (Service)',
      dueDate: new Date(),
    }
  });

  // 6. Create Outstanding RENT Invoice (Priority 2)
  await prisma.invoice.create({
    data: {
      invoiceNo: 'INV-TEST-RENT',
      tenantId: tenant.id,
      unitId: unit.id,
      month: 'March',
      amount: 600,
      rent: 600,
      category: 'RENT',
      status: 'unpaid',
      paidAmount: 0,
      balanceDue: 600,
      description: 'Last Month Rent (Early Termination)',
      dueDate: new Date(),
    }
  });

  console.log('\n✅ SEED COMPLETE!');
  console.log('------------------');
  console.log('Tenant Created: Test Allocation Tenant');
  console.log('Balance to Check:');
  console.log('  - Paid Deposit: $1,000');
  console.log('  - Service Due: $300');
  console.log('  - Rent Due: $600');
  console.log('\n🚀 SYSTEM CALCULATION SHOULD BE:');
  console.log('  - Clears Service Fee: $300');
  console.log('  - Clears Rent: $600');
  console.log('  - Physical Refund to pay: $100');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
