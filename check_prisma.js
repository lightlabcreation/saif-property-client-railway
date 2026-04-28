const prisma = require('./src/config/prisma');
console.log('Prisma Models:', Object.keys(prisma).filter(k => !k.startsWith('_') && !k.startsWith('$')));
process.exit(0);
