const prisma = require('../../config/prisma');

// GET /api/tenant/dashboard
exports.getDashboard = async (req, res) => {
    try {
        const userId = req.user.id;

        // 1. Get Tenant details with active lease
        const tenant = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                leases: {
                    where: { status: 'Active' },
                    include: { unit: true }
                },
                insurances: true
            }
        });

        if (!tenant) return res.status(404).json({ message: 'Tenant not found' });

        const activeLease = tenant.leases[0];

        // 2. Real calculation for Dashboard

        // Open Tickets Count
        const openTickets = await prisma.ticket.count({
            where: {
                userId,
                status: { not: 'Resolved' }
            }
        });

        // 3. Get Recent Tickets (latest 3)
        const recentTickets = await prisma.ticket.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' },
            take: 3,
            select: { id: true, subject: true, status: true }
        });

        // 4. Get Unread Messages Count (from Admin)
        const unreadCount = await prisma.message.count({
            where: {
                receiverId: userId,
                sender: { role: 'ADMIN' },
                isRead: false
            }
        });

        // Rent Due Status
        let rentDueStatus = 'No Dues';
        let currentRent = 0;
        let nextDueDate = null;

        if (activeLease) {
            currentRent = parseFloat(activeLease.monthlyRent);

            // Find latest unpaid invoice
            const latestInvoice = await prisma.invoice.findFirst({
                where: {
                    tenantId: userId,
                    status: { not: 'paid' }
                },
                orderBy: { dueDate: 'asc' } // Earliest due date first
            });

            if (latestInvoice) {
                const balance = parseFloat(latestInvoice.balanceDue);
                if (balance > 0) {
                    rentDueStatus = `Due: $${balance.toLocaleString('en-CA')}`;
                    nextDueDate = latestInvoice.dueDate;
                } else {
                    rentDueStatus = 'All Paid';
                }
            } else {
                rentDueStatus = 'All Paid';
            }
        }

        const stats = {
            currentRent,
            rentDueStatus,
            nextDueDate,
            leaseStatus: activeLease ? 'Active' : 'No Active Lease',
            leaseExpiry: activeLease ? activeLease.endDate : null,
            insuranceStatus: tenant.insurances.length > 0 ? 'Compliant' : 'Missing',
            openTickets: openTickets, // Return numeric only
            unreadCount,
            recentTickets: recentTickets.map(t => ({
                id: `T-${t.id + 1000}`,
                title: t.subject,
                status: t.status
            }))
        };

        res.json({
            tenantName: tenant.name,
            stats
        });

    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/tenant/reports – dynamic stats and report definitions for tenant
exports.getReports = async (req, res) => {
    try {
        const userId = req.user.id;

        // 1. Fetch Invoices with Payments
        const invoices = await prisma.invoice.findMany({
            where: { tenantId: userId, status: { not: 'draft' } },
            include: {
                payments: true,
                unit: true
            },
            orderBy: { createdAt: 'desc' }
        });

        // 2. Extract All Payments
        const allPayments = [];
        invoices.forEach(inv => {
            (inv.payments || []).forEach(p => {
                allPayments.push({
                    id: p.id,
                    invoiceNo: inv.invoiceNo,
                    amount: parseFloat(p.amount),
                    method: p.method,
                    date: p.date.toISOString().split('T')[0],
                    month: inv.month
                });
            });
        });
        allPayments.sort((a, b) => new Date(b.date) - new Date(a.date));

        // 3. Stats calculation
        const paidAmount = invoices.reduce((sum, i) => sum + parseFloat(i.paidAmount || 0), 0);
        const outstandingAmount = invoices.reduce((sum, i) => sum + parseFloat(i.balanceDue || 0), 0);
        const paidCount = allPayments.length;

        // 4. Formatting for UI
        const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const lastPaidAt = allPayments[0]?.date
            ? new Date(allPayments[0].date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : 'None';

        const reports = [
            {
                id: 'payment_history',
                title: 'Payment History',
                description: 'All rent and fee payments for your tenancy.',
                type: 'payment_history',
                lastGenerated: lastPaidAt,
                data: allPayments
            },
            {
                id: 'invoice_summary',
                title: 'Invoice Summary',
                description: 'Invoices issued and payment status by month.',
                type: 'invoice_summary',
                lastGenerated: today,
                data: invoices.map(i => ({
                    id: i.invoiceNo,
                    month: i.month,
                    amount: parseFloat(i.amount),
                    paid: parseFloat(i.paidAmount),
                    balance: parseFloat(i.balanceDue),
                    status: i.status,
                    date: i.createdAt.toISOString().split('T')[0]
                }))
            },
        ];

        res.json({
            reports,
            stats: {
                totalInvoices: invoices.length,
                paidCount: paidCount,
                paidAmount: Math.round(paidAmount * 100) / 100,
                outstandingAmount: Math.round(outstandingAmount * 100) / 100,
                reportsViewable: `${reports.length} Available`,
                reportsViewableSub: 'Your account',
                dataLatency: 'Real-time',
            }
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};


// GET /api/tenant/profile
exports.getProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const tenant = await prisma.user.findUnique({
            where: { id: userId },
            include: {
                leases: {
                    where: { status: 'Active' },
                    include: {
                        unit: {
                            include: { property: true }
                        }
                    }
                }
            }
        });

        if (!tenant) return res.status(404).json({ message: 'Tenant not found' });

        const activeLease = tenant.leases[0];
        const buildingName = activeLease?.unit?.property?.name || 'No Building';
        const unitNumber = activeLease?.unit?.unitNumber || '';

        const name = tenant.name ||
            (tenant.firstName && tenant.lastName ? `${tenant.firstName} ${tenant.lastName}` : 'Tenant');

        res.json({
            name,
            buildingName,
            unitNumber
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};
