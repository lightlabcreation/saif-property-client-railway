const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const tenants = await prisma.user.findMany({
        where: { role: 'TENANT' },
        include: {
            leases: {
                include: {
                    unit: {
                        include: {
                            property: true
                        }
                    }
                }
            }
        }
    });
    
    const jean = tenants.find(t => t.name.includes('Jean Dupont'));
    console.log('Jean Dupont Data:');
    if (jean) {
        console.log('ID:', jean.id);
        console.log('Leases Count:', jean.leases.length);
        jean.leases.forEach((l, i) => {
            console.log(`Lease ${i+1}:`, {
                unitId: l.unitId,
                propertyId: l.unit?.propertyId,
                propertyName: l.unit?.property?.name
            });
        });
    } else {
        console.log('Jean Dupont not found');
    }
    
    process.exit(0);
}

main();
