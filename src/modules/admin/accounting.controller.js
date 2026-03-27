const prisma = require('../../config/prisma');

// GET /api/admin/accounting/transactions
exports.getTransactions = async (req, res) => {
    try {
        const txs = await prisma.transaction.findMany({
            orderBy: { date: 'desc' },
            take: 100,
            include: {
                invoice: { select: { tenant: { select: { name: true } } } },
                payment: { include: { invoice: { select: { tenant: { select: { name: true } } } } } }
            }
        });

        const formatted = txs.map(t => {
            // Priority: Payment Tenant > Invoice Tenant > Description fallback
            const tenantName = 
                t.payment?.invoice?.tenant?.name || 
                t.invoice?.tenant?.name || 
                "Administrative";

            return {
                id: t.id,
                date: t.date.toISOString().split('T')[0],
                tenant: tenantName,
                description: t.description,
                type: t.type,
                amount: parseFloat(t.amount),
                balance: parseFloat(t.balance),
                status: t.status
            };
        });

        res.json(formatted);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/admin/accounting/transactions
exports.createTransaction = async (req, res) => {
    try {
        const { date, description, type, amount, status } = req.body;

        // Simple balance logic: last balance + amount
        const lastTx = await prisma.transaction.findFirst({
            orderBy: { id: 'desc' }
        });
        const prevBalance = lastTx ? parseFloat(lastTx.balance) : 0;
        const newBalance = prevBalance + parseFloat(amount);

        const newTx = await prisma.transaction.create({
            data: {
                date: new Date(date),
                description,
                type,
                amount: parseFloat(amount),
                balance: newBalance,
                status: status || 'Paid'
            }
        });

        res.status(201).json(newTx);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error creating transaction' });
    }
};
