const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function masterSync() {
    console.log("🚀 STARTING PRODUCTION MASTER SYNC...");

    // 1. SYNC UNIT READINESS (Green Dots)
    console.log("\n--- Part 1: Activating existing units ---");
    const activationDate = new Date();
    const result = await prisma.unit.updateMany({
        where: {
            unit_status: { not: 'ACTIVE' }
        },
        data: {
            unit_status: 'ACTIVE',
            ready_for_leasing: true,
            gc_delivered_completed: true,
            gc_delivered_completed_date: activationDate,
            gc_deficiencies_completed: true,
            gc_deficiencies_completed_date: activationDate,
            gc_cleaned_completed: true,
            gc_cleaned_completed_date: activationDate,
            ffe_installed_completed: true,
            ffe_installed_completed_date: activationDate,
            ose_installed_completed: true,
            ose_installed_completed_date: activationDate,
            final_cleaning_completed: true,
            final_cleaning_completed_date: activationDate,
            unit_ready_completed: true,
            unit_ready_completed_date: activationDate,
            availability_status: 'Available'
        }
    });
    console.log(`✅ Activated ${result.count} units.`);

    // 2. FIX VICTOR BIASSETTI'S LEDGER ($925)
    console.log("\n--- Part 2: Repairing Ledger Discrepancies ---");
    const ra6 = await prisma.refundAdjustment.findFirst({ where: { requestId: 'RA-00006' } });
    if (ra6) {
        // Check if repair transaction already exists to avoid duplicates
        const existingTx = await prisma.transaction.findFirst({
            where: { description: { contains: 'REPAIR: SD Allocation [Liability] - RA-00006' } }
        });

        if (!existingTx) {
            const lastTx = await prisma.transaction.findFirst({ orderBy: { id: 'desc' } });
            const prevBal = lastTx ? parseFloat(lastTx.balance) : 0;
            
            await prisma.transaction.create({
                data: {
                    date: ra6.date,
                    description: 'REPAIR: SD Allocation [Liability] - RA-00006',
                    type: 'Liability Deduction',
                    amount: 925,
                    balance: prevBal - 925,
                    status: 'Completed'
                }
            });
            console.log("✅ Fixed Victor's Ledger Liability.");
        } else {
            console.log("ℹ️ Victor's Ledger already fixed.");
        }
    }

    // 3. FIX REVENUE DASHBOARD BUCKETS ($925 Move)
    console.log("\n--- Part 3: Repairing Dashboard Buckets ---");
    if (ra6) {
        const existingPayment = await prisma.payment.findFirst({
            where: { reference: 'RA-00006' }
        });

        if (!existingPayment) {
            const rentInv = await prisma.invoice.findFirst({
                where: { tenantId: ra6.tenantId, category: 'RENT' }
            });

            if (rentInv) {
                await prisma.payment.create({
                    data: {
                        invoiceId: rentInv.id,
                        amount: 925,
                        method: 'Security Deposit Allocation',
                        date: ra6.date,
                        reference: 'RA-00006'
                    }
                });
                console.log("✅ Fixed Victor's Dashboard Categories.");
            }
        } else {
            console.log("ℹ️ Dashboard categories already fixed.");
        }
    }

    console.log("\n✨ PRODUCTION SYNC COMPLETE! ✨");
    process.exit(0);
}

masterSync().catch(err => {
    console.error("❌ SYNC FAILED:", err);
    process.exit(1);
});
