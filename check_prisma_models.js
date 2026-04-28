const prisma = require('./src/config/prisma');

async function checkPrismaKeys() {
    console.log('--- PRISMA CLIENT MODELS ---');
    const keys = Object.keys(prisma).filter(k => !k.startsWith('_'));
    console.log(keys.sort().join('\n'));
    process.exit(0);
}

checkPrismaKeys();
