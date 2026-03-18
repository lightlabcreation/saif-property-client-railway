const prisma = require('../../config/prisma');

// GET /api/admin/refunds
exports.getRefunds = async (req, res) => {
    try {
        const refunds = await prisma.refundAdjustment.findMany({
            include: {
                tenant: true,
                unit: true
            },
            orderBy: {
                date: 'desc'
            }
        });

        const formatted = refunds.map(r => ({
            id: r.requestId,
            type: r.type,
            reason: r.reason,
            tenant: r.tenant?.name || (r.tenant?.firstName ? `${r.tenant.firstName} ${r.tenant.lastName || ''}`.trim() : 'Unknown Tenant'),
            unit: r.unit.name,
            amount: parseFloat(r.amount),
            date: r.date.toLocaleDateString('en-GB', {
                day: '2-digit', month: 'short', year: 'numeric'
            }),
            status: r.status,
            issuedDate: r.issuedDate ? r.issuedDate.toISOString().split('T')[0] : null,
            method: r.method,
            referenceNumber: r.referenceNumber,
            proofUrl: r.proofUrl,
            outcomeReason: r.outcomeReason || 'Pending review'
        }));

        res.json(formatted);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/admin/refunds
exports.createRefund = async (req, res) => {
    try {
        const { type, reason, tenantId, unitId, amount, status, date, issuedDate, method, referenceNumber, proofUrl, outcomeReason } = req.body;

        const result = await prisma.$transaction(async (tx) => {
            const count = await tx.refundAdjustment.count();
            const requestId = `RA-${String(count + 1).padStart(5, '0')}`;

            const refundamt = parseFloat(amount) || 0;

            const refund = await tx.refundAdjustment.create({
                data: {
                    requestId,
                    type,
                    reason,
                    tenantId: parseInt(tenantId),
                    unitId: parseInt(unitId),
                    amount: refundamt,
                    status: status || 'Pending',
                    date: date ? new Date(date) : new Date(),
                    issuedDate: issuedDate ? new Date(issuedDate) : null,
                    method: method || null,
                    referenceNumber: referenceNumber || null,
                    proofUrl: proofUrl || null,
                    outcomeReason: outcomeReason || 'Pending review'
                }
            });

            // Notification for Security Deposit (Requirement from user)
            if (type.toLowerCase().includes('deposit') || reason.toLowerCase().includes('deposit')) {
                await tx.message.create({
                    data: {
                        content: `Notification: A ${type} of $${refundamt} has been processed for your account. Reason: ${reason}`,
                        senderId: req.user?.id || 1, // Fallback to 1 (Admin) if auth middleware is off
                        receiverId: parseInt(tenantId)
                    }
                });
            }

            // Ledger Entry (Accounting Requirement)
            const lastTx = await tx.transaction.findFirst({ orderBy: { id: 'desc' } });
            const prevBalance = lastTx ? parseFloat(lastTx.balance) : 0;

            await tx.transaction.create({
                data: {
                    date: new Date(),
                    description: `${type} Refund - ${requestId}`,
                    type: type.toLowerCase().includes('deposit') ? 'Liability' : 'Expense',
                    amount: refundamt,
                    balance: prevBalance - refundamt,
                    status: 'Completed'
                }
            });

            return refund;
        });

        res.status(201).json(result);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error creating refund' });
    }
};

// PUT /api/admin/refunds/:id
exports.updateRefund = async (req, res) => {
    try {
        const { status, reason, amount, issuedDate, method, referenceNumber, proofUrl, outcomeReason } = req.body;
        const { id } = req.params;

        const updated = await prisma.refundAdjustment.update({
            where: { requestId: id },
            data: {
                status,
                reason,
                amount: amount ? parseFloat(amount) : undefined,
                issuedDate: issuedDate ? new Date(issuedDate) : undefined,
                method: method !== undefined ? method : undefined,
                referenceNumber: referenceNumber !== undefined ? referenceNumber : undefined,
                proofUrl: proofUrl !== undefined ? proofUrl : undefined,
                outcomeReason: outcomeReason !== undefined ? outcomeReason : undefined
            }
        });

        res.json(updated);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error updating refund' });
    }
};

// DELETE /api/admin/refunds/:id
exports.deleteRefund = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.refundAdjustment.delete({
            where: { requestId: id }
        });
        res.json({ message: 'Refund record deleted' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error deleting refund' });
    }
};

// GET /api/admin/refunds/calculate/:tenantId
exports.calculateRefund = async (req, res) => {
    try {
        const tenantId = parseInt(req.params.tenantId);

        // 1. Get Paid Security Deposits
        const depositInvoices = await prisma.invoice.findMany({
            where: {
                tenantId,
                status: 'paid',
                OR: [
                    { category: 'SECURITY_DEPOSIT' },
                    { description: { contains: 'Security Deposit' } }
                ]
            }
        });

        const totalDepositPaid = depositInvoices.reduce((sum, inv) => sum + parseFloat(inv.paidAmount || 0), 0);

        // 2. Get Service Fee Invoices (Deductions)
        const serviceInvoices = await prisma.invoice.findMany({
            where: {
                tenantId,
                category: 'SERVICE'
            }
        });

        const totalServiceCharges = serviceInvoices.reduce((sum, inv) => sum + parseFloat(inv.amount || 0), 0);

        // 3. Final Calculation Ratio
        const finalRefundAmount = Math.max(0, totalDepositPaid - totalServiceCharges);

        res.json({
            tenantId,
            totalDepositPaid,
            totalServiceCharges,
            finalRefundAmount,
            appliedServiceInvoices: serviceInvoices.map(inv => ({ invoiceNo: inv.invoiceNo, amount: parseFloat(inv.amount) }))
        });

    } catch (e) {
        console.error('Calculate Refund Error:', e);
        res.status(500).json({ message: 'Error calculating refund: ' + (e.message || 'Server error') });
    }
};
