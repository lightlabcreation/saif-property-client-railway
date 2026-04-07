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
                status: t.status,
                paymentId: t.paymentId,
                invoiceId: t.invoiceId
            };
        });

        // 🟢 SMART FILTER: UNIQUE RECORDS ONLY
        const seenPayments = new Set();
        const seenRefunds = new Set();
        const seenInvoices = new Set();
        
        // 1. Remove exact system duplicates
        const uniqueTxs = formatted.filter(t => {
            // Deduplicate Payments (Same paymentId)
            if (t.paymentId) {
                if (seenPayments.has(t.paymentId)) return false;
                seenPayments.add(t.paymentId);
            }
            
            // Deduplicate Refunds/Adjustments (Same Request ID in description)
            const refundRef = t.description.match(/REG-\d+|REF-\d+|ADJ-\d+|RA-\d+/);
            if (refundRef) {
                const id = refundRef[0];
                if (seenRefunds.has(id)) return false;
                seenRefunds.add(id);
            }

            return true;
        });

        // 2. RE-CALCULATE BALANCES (Top-Down to ensure logic is perfect)
        // Note: Ledger is sorted by date DESC (Latest at [0])
        // We calculate bottom-up for the current batch
        let runningBalance = uniqueTxs.length > 0 ? (uniqueTxs[uniqueTxs.length - 1].balance || 0) : 0;
        for (let i = uniqueTxs.length - 2; i >= 0; i--) {
            const t = uniqueTxs[i];
            const prev = uniqueTxs[i + 1];
            
            // If it's an INCOME/Payment, balance increases. If it's a LIABILITY/Refund, balance decreases.
            // But we use the stored amount's sign logic
            const amt = t.type?.toUpperCase() === 'INCOME' || t.type?.toUpperCase() === 'PAYMENT' 
                ? t.amount 
                : -Math.abs(t.amount); // Force negative for refunds/deductions
                
            runningBalance += amt;
            t.balance = runningBalance;
        }

        res.json(uniqueTxs);
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
