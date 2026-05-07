const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    try {
        // Find an active lease
        const lease = await prisma.lease.findFirst({
            where: { status: 'Active' },
            include: { unit: true }
        });

        if (!lease) {
            console.log('No active lease found to create a dummy move-out.');
            return;
        }

        console.log(`Found Lease ID: ${lease.id} for Unit: ${lease.unit.name}`);

        // Set targetDate to today so it shows up in the "Next 30 Days" filter
        const today = new Date();

        // Create a dummy MoveOut record in VISUAL_INSPECTION_SCHEDULED state
        const moveOut = await prisma.moveOut.upsert({
            where: { leaseId: lease.id },
            update: {
                status: 'VISUAL_INSPECTION_SCHEDULED',
                targetDate: today,
                visualDate: today,
                visualTime: '10:00 AM'
            },
            create: {
                leaseId: lease.id,
                unitId: lease.unitId,
                status: 'VISUAL_INSPECTION_SCHEDULED',
                targetDate: today,
                visualDate: today,
                visualTime: '10:00 AM'
            }
        });

        // Create a dummy Inspection linked to this MoveOut
        const template = await prisma.inspectionTemplate.findFirst({ where: { type: 'VISUAL' } });
        
        if (!template) {
            console.log('No Visual template found. Please create one first.');
            return;
        }

        // Clean up old draft inspections for this lease to avoid confusion
        await prisma.inspection.updateMany({
            where: { leaseId: lease.id, status: 'DRAFT' },
            data: { status: 'CANCELLED' }
        });

        const inspection = await prisma.inspection.create({
            data: {
                templateId: template.id,
                unitId: lease.unitId,
                leaseId: lease.id,
                status: 'DRAFT',
                inspectorId: 1 // Assuming ID 1 exists
            }
        });

        // Link the inspection to the MoveOut
        await prisma.moveOut.update({
            where: { id: moveOut.id },
            data: { visualInspectionId: inspection.id }
        });

        console.log('--- TEST DATA CREATED ---');
        console.log(`Move-Out ID: ${moveOut.id} (Status: VISUAL_INSPECTION_SCHEDULED)`);
        console.log(`Target Date: ${today.toISOString().split('T')[0]}`);
        console.log(`Inspection ID: ${inspection.id} (Status: DRAFT)`);
        console.log('-------------------------');
        console.log(`Now go to: http://localhost:3000/admin/workflow/inspections/${inspection.id}`);
        console.log('Click "Cancel Inspection" and verify if Move-Out moves back to "Confirmed".');

    } catch (err) {
        console.error(err);
    } finally {
        await prisma.$disconnect();
    }
}

main();
