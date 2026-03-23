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
            tenantId: r.tenantId,
            unit: r.unit.name,
            unitId: r.unitId,
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

            // Auto-manage issuedDate based on status
            let finalIssuedDate = issuedDate ? new Date(issuedDate) : null;
            if (status === 'Completed' && !finalIssuedDate) {
                finalIssuedDate = new Date(); // Default to today if completed
            } else if (status === 'Pending') {
                finalIssuedDate = null; // Clear if pending
            }

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
                    issuedDate: finalIssuedDate,
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

        const updated = await prisma.$transaction(async (tx) => {
            const current = await tx.refundAdjustment.findUnique({
                where: { requestId: id }
            });

            if (!current) throw new Error('Refund not found');

            // Smart Date Logic: Auto-populate issuedDate on completion
            let finalIssuedDate = issuedDate ? new Date(issuedDate) : (current.issuedDate || undefined);
            if (status === 'Completed' && current.status !== 'Completed' && !issuedDate) {
                finalIssuedDate = new Date(); // Set to now if completing
            } else if (status === 'Pending') {
                finalIssuedDate = null; // Clear if pending
            }

            const updatedRefund = await tx.refundAdjustment.update({
                where: { requestId: id },
                data: {
                    status,
                    reason,
                    amount: amount ? parseFloat(amount) : undefined,
                    issuedDate: finalIssuedDate,
                    method: method !== undefined ? method : undefined,
                    referenceNumber: referenceNumber !== undefined ? referenceNumber : undefined,
                    proofUrl: proofUrl !== undefined ? proofUrl : undefined,
                    outcomeReason: outcomeReason !== undefined ? outcomeReason : undefined
                }
            });

            // Ledger Entry (Accounting Requirement) - Only if moving TO Completed
            if (status === 'Completed' && current.status !== 'Completed') {
                const refundamt = parseFloat(amount || updatedRefund.amount) || 0;
                const lastTx = await tx.transaction.findFirst({ orderBy: { id: 'desc' } });
                const prevBalance = lastTx ? parseFloat(lastTx.balance) : 0;

                await tx.transaction.create({
                    data: {
                        date: new Date(),
                        description: `${updatedRefund.type} Refund - ${id}`,
                        type: updatedRefund.type.toLowerCase().includes('deposit') ? 'Liability' : 'Expense',
                        amount: refundamt,
                        balance: prevBalance - refundamt,
                        status: 'Completed'
                    }
                });
            }

            return updatedRefund;
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

        // 3. Subtract existing refunds already processed
        const existingRefunds = await prisma.refundAdjustment.findMany({
            where: {
                tenantId,
                status: { in: ['Completed', 'Issued'] }
            }
        });
        const totalRefundedAlready = existingRefunds.reduce((sum, r) => sum + parseFloat(r.amount || 0), 0);

        // 4. Final Calculation Ratio
        const finalRefundAmount = Math.max(0, totalDepositPaid - totalServiceCharges - totalRefundedAlready);

        res.json({
            tenantId,
            totalDepositPaid,
            totalServiceCharges,
            totalRefundedAlready,
            finalRefundAmount,
            appliedServiceInvoices: serviceInvoices.map(inv => ({ invoiceNo: inv.invoiceNo, amount: parseFloat(inv.amount) }))
        });

    } catch (e) {
        console.error('Calculate Refund Error:', e);
        res.status(500).json({ message: 'Error calculating refund: ' + (e.message || 'Server error') });
    }
};
