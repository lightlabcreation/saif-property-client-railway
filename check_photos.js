const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkPhotos() {
  const responses = await prisma.inspectionItemResponse.findMany({
    where: { inspectionId: 8 },
    include: { media: true }
  });
  console.log('Responses with Media for Inspection 8:', JSON.stringify(responses, null, 2));
  process.exit(0);
}

checkPhotos();
