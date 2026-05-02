const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function clean() {
  try {
    // Move everything that might be causing a crash back to PENDING
    // This includes the new status that the client doesn't recognize yet
    await prisma.$executeRaw`UPDATE MoveOut SET status = 'PENDING' WHERE status NOT IN ('PENDING', 'CONFIRMED', 'VISUAL_INSPECTION_SCHEDULED', 'FINAL_INSPECTION_SCHEDULED', 'INSPECTIONS_COMPLETED', 'COMPLETED', 'CANCELLED')`;
    await prisma.$executeRaw`UPDATE MoveOut SET status = 'PENDING' WHERE status = '' OR status IS NULL`;
    
    console.log('Cleaned up statuses to restore dashboard access');
  } catch (e) {
    console.error('Clean error:', e);
  } finally {
    await prisma.$disconnect();
  }
}

clean();
