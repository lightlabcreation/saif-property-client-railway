const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
    try {
        const count = await prisma.unit.count();
        console.log("\n✅ TOTAL UNITS IN DATABASE:", count);
        
        const rates = await prisma.unitTypeRate.count();
        console.log("✅ TOTAL RATES DEFINED:", rates);
        
        process.exit(0);
    } catch (e) {
        console.error("❌ Error querying DB:", e);
        process.exit(1);
    }
}
run();
