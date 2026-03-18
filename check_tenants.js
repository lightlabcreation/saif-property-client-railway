const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      role: true
    }
  });
  console.log('Users in DB:');
  console.table(users);

  const invoices = await prisma.invoice.findMany({
    take: 5,
    include: {
      tenant: true
    }
  });
  console.log('Sample Invoices with Tenants:');
  invoices.forEach(inv => {
    console.log(`Invoice: ${inv.invoiceNo}, TenantId: ${inv.tenantId}, TenantName: ${inv.tenant?.name}, TenantFirst: ${inv.tenant?.firstName}, TenantLast: ${inv.tenant?.lastName}`);
  });
}

main()
  .catch(e => console.error(e))
  .finally(async () => await prisma.$disconnect());
