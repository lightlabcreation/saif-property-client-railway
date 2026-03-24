const prisma = require('../../config/prisma');
const communicationService = require('../../services/communicationService');

// GET /api/admin/insurance/compliance
exports.getComplianceDashboard = async (req, res) => {
    try {
        // Fetch all tenants to ensure we see MISSING ones
        const tenants = await prisma.user.findMany({
            where: {
                role: 'TENANT',
                type: { not: 'RESIDENT' }
            },
            include: {
                insurances: {
                    orderBy: { endDate: 'desc' }
                },
                residentLease: { include: { unit: { include: { property: true } } } },
                leases: {
                    where: { status: 'Active' },
                    include: { unit: { include: { property: true } } }
                }
            }
        });

        const formatted = [];

        tenants.forEach(tenant => {
            const tenantNameStr = tenant.name || `${tenant.firstName || ''} ${tenant.lastName || ''}`.trim();
            const activeLeases = tenant.leases && tenant.leases.length > 0 ? tenant.leases : (tenant.residentLease ? [tenant.residentLease] : []);

            if (activeLeases.length === 0) {
                // Return explicitly missing for tenants without a unit/lease assigned yet
                formatted.push({
                    tenantId: tenant.id,
                    tenantName: tenantNameStr,
                    tenantType: tenant.type,
                    building: 'N/A',
                    unitNumber: 'N/A',
                    status: 'MISSING',
                    daysRemaining: null,
                    provider: 'N/A',
                    policyNumber: 'N/A',
                    startDate: 'N/A',
                    expiryDate: 'N/A',
                    notes: '',
                    insuranceId: null,
                    unitId: null,
                    leaseId: null,
                    documentUrl: null,
                    uploadedDocumentId: null
                });
                return;
            }

            activeLeases.forEach(lease => {
                const propertyName = lease?.unit?.property?.name || 'N/A';
                const unitName = lease?.unit?.unitNumber || lease?.unit?.name || 'N/A';
                const unitId = lease?.unit?.id || null;
                const leaseId = lease?.id || null;

                // Find insurance for THIS unit/lease specifically if possible
                const matchingInsurances = tenant.insurances.filter(ins => ins.unitId === unitId);

                if (matchingInsurances.length === 0) {
                    formatted.push({
                        tenantId: tenant.id,
                        tenantName: tenantNameStr,
                        tenantType: tenant.type,
                        building: propertyName,
                        unitNumber: unitName,
                        status: 'MISSING',
                        daysRemaining: null,
                        provider: 'N/A',
                        policyNumber: 'N/A',
                        startDate: 'N/A',
                        expiryDate: 'N/A',
                        notes: '',
                        insuranceId: null,
                        unitId,
                        leaseId,
                        documentUrl: null,
                        uploadedDocumentId: null
                    });
                } else {
                    matchingInsurances.forEach(insurance => {
                        const today = new Date();
                        today.setHours(0,0,0,0);
                        const end = new Date(insurance.endDate);
                        const daysRemaining = Math.ceil((end - today) / (1000 * 60 * 60 * 24));

                        formatted.push({
                            tenantId: tenant.id,
                            tenantName: tenantNameStr,
                            tenantType: tenant.type,
                            building: propertyName,
                            unitNumber: unitName,
                            status: insurance.status,
                            daysRemaining,
                            provider: insurance.provider || 'N/A',
                            policyNumber: insurance.policyNumber || 'N/A',
                            startDate: insurance.startDate ? insurance.startDate.toISOString().split('T')[0] : 'N/A',
                            expiryDate: insurance.endDate ? insurance.endDate.toISOString().split('T')[0] : 'N/A',
                            notes: insurance.notes || '',
                            insuranceId: insurance.id,
                            unitId,
                            leaseId,
                            documentUrl: insurance.documentUrl || null,
                            uploadedDocumentId: insurance.uploadedDocumentId || null
                        });
                    });
                }
            });
        });

        res.json(formatted);
    } catch (e) {
        console.error('Compliance Dashboard Error:', e);
        res.status(500).json({ message: 'Server error' });
    }
};

// Internal function to check and send alerts & update statuses
exports.checkInsuranceExpirations = async () => {
    console.log('[Insurance] Checking for expiring policies per client limits (15 days)');
    const today = new Date();
    today.setHours(0,0,0,0);

    try {
        const activeInsurances = await prisma.insurance.findMany({
            where: { status: { in: ['ACTIVE', 'EXPIRING_SOON'] } }
        });

        for (const ins of activeInsurances) {
            const end = new Date(ins.endDate);
            const diffDays = Math.ceil((end - today) / (1000 * 60 * 60 * 24));

            let newStatus = ins.status;
            if (diffDays <= 0) {
                newStatus = 'EXPIRED';
            } else if (diffDays <= 15) {
                newStatus = 'EXPIRING_SOON';
            }

            if (newStatus !== ins.status) {
                await prisma.insurance.update({
                    where: { id: ins.id },
                    data: { status: newStatus }
                });
                console.log(`[Insurance] Updated policy ${ins.id} status to ${newStatus}`);
            }
        }
    } catch (e) {
        console.error('Check Expirations Error:', e);
    }
};

// GET /api/admin/insurance/alerts
exports.getInsuranceAlerts = async (req, res) => {
    try {
        const { status } = req.query; // Filter by status if provided

        const where = {};
        if (status) {
            where.status = status;
        }

        const insurances = await prisma.insurance.findMany({
            where,
            include: {
                user: true,
                lease: {
                    include: {
                        unit: { include: { property: true } }
                    }
                },
                unit: { include: { property: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        const getExpiryStatus = (endDate, status) => {
            if (status === 'EXPIRED') return { label: 'Expired', color: 'red', days: 0 };
            if (status === 'EXPIRING_SOON') return { label: 'Expiring Soon', color: 'amber', days: 15 };
            if (status === 'ARCHIVED') return { label: 'Archived', color: 'gray', days: 0 };
            
            const end = new Date(endDate);
            const today = new Date();
            const diffTime = end - today;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

            if (diffDays <= 0) return { label: 'Expired', color: 'red', days: diffDays };
            if (diffDays <= 15) return { label: 'Expiring Soon', color: 'amber', days: diffDays };
            return { label: 'Active', color: 'emerald', days: diffDays };
        };

        const formatted = insurances.map(ins => {
            const unit = ins.unit || ins.lease?.unit;
            const expiry = getExpiryStatus(ins.endDate, ins.status);

            return {
                id: ins.id,
                tenantName: ins.user?.name || 'N/A',
                property: unit ? unit.property.name : 'Unknown',
                unit: unit ? unit.name : 'N/A',
                provider: ins.provider,
                policyNumber: ins.policyNumber,
                startDate: ins.startDate.toISOString().substring(0, 10),
                endDate: ins.endDate.toISOString().substring(0, 10),
                documentUrl: (ins.documentUrl && ins.uploadedDocumentId)
                    ? `/api/admin/documents/${ins.uploadedDocumentId}/download?disposition=inline`
                    : ins.documentUrl,
                uploadedDocumentId: ins.uploadedDocumentId,
                status: ins.status,
                rejectionReason: ins.rejectionReason,
                notes: ins.notes,
                expiry: expiry,
                tenantId: ins.userId,
                unitId: ins.unitId
            };
        });

        res.json(formatted);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

// POST /api/admin/insurance/:id/approve
exports.approveInsurance = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const insurance = await prisma.insurance.update({
            where: { id },
            data: { status: 'ACTIVE', rejectionReason: null }
        });

        // Trigger notification Logic
        try {
            await communicationService.sendInsuranceApproved(insurance.userId, insurance.id);
        } catch (e) { console.error('Notification failed:', e); }

        res.json({ message: 'Insurance approved successfully', insurance });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Failed to approve insurance' });
    }
};

// POST /api/admin/insurance/:id/reject
exports.rejectInsurance = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { reason } = req.body;

        if (!reason) {
            return res.status(400).json({ message: 'Rejection reason is required' });
        }

        const insurance = await prisma.insurance.update({
            where: { id },
            data: { status: 'REJECTED', rejectionReason: reason }
        });

        // Trigger notification Logic
        try {
            await communicationService.sendInsuranceRejected(insurance.userId, insurance.id, reason);
        } catch (e) { console.error('Notification failed:', e); }

        res.json({ message: 'Insurance rejected successfully', insurance });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Failed to reject insurance' });
    }
};

// GET /api/admin/insurance/stats
exports.getInsuranceStats = async (req, res) => {
    try {
        const today = new Date();
        const thirtyDaysOut = new Date();
        thirtyDaysOut.setDate(today.getDate() + 30);

        const [missingCount] = await prisma.$queryRaw`
            SELECT COUNT(u.id) as missing
            FROM user u
            WHERE u.role = 'TENANT' 
            AND u.type != 'RESIDENT'
            AND NOT EXISTS (
                SELECT 1 FROM insurance i WHERE i.userId = u.id AND i.status IN ('ACTIVE', 'EXPIRING_SOON')
            )
        `;

        const userFilter = { role: 'TENANT', type: { not: 'RESIDENT' } };
        const [active, expiring, expired, pending] = await Promise.all([
            prisma.insurance.count({ where: { status: 'ACTIVE', user: userFilter } }),
            prisma.insurance.count({ where: { status: 'EXPIRING_SOON', user: userFilter } }),
            prisma.insurance.count({ where: { status: 'EXPIRED', user: userFilter } }),
            prisma.insurance.count({ where: { status: 'PENDING_APPROVAL', user: userFilter } })
        ]);

        res.json({
            active,
            expiring,
            expired,
            pending,
            missing: Number(missingCount?.missing || 0)
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Failed to fetch insurance stats' });
    }
};

// POST /api/admin/insurance
exports.createInsurance = async (req, res) => {
    try {
        const { userId, provider, policyNumber, endDate, startDate, documentUrl, uploadedDocumentId, notes, unitId, leaseId } = req.body;

        if (!userId || !endDate) {
            return res.status(400).json({ message: 'Tenant ID and Expiry Date are required' });
        }

        const data = {
            userId: parseInt(userId),
            provider: provider || 'TBD',
            policyNumber: policyNumber || 'TBD',
            startDate: startDate ? new Date(startDate) : new Date(),
            endDate: new Date(endDate),
            documentUrl: documentUrl || null,
            uploadedDocumentId: uploadedDocumentId ? parseInt(uploadedDocumentId) : null,
            notes: notes || null,
            status: 'ACTIVE',
            unitId: unitId ? parseInt(unitId) : null,
            leaseId: leaseId ? parseInt(leaseId) : null
        };

        // If today is within 15 days of end date, map straight to EXPIRING_SOON
        const today = new Date();
        today.setHours(0,0,0,0);
        const end = new Date(data.endDate);
        const diffDays = Math.ceil((end - today) / (1000 * 60 * 60 * 24));
        if (diffDays <= 0) {
            data.status = 'EXPIRED';
        } else if (diffDays <= 15) {
            data.status = 'EXPIRING_SOON';
        }

        // Archive previous active records in transaction
        const result = await prisma.$transaction(async (tx) => {
            // Find records for the SAME unitId to avoid cross-unit archiving
            await tx.insurance.updateMany({
                where: { 
                    userId: data.userId, 
                    unitId: data.unitId,
                    status: { in: ['ACTIVE', 'EXPIRING_SOON'] } 
                },
                data: { status: 'ARCHIVED' }
            });
            return await tx.insurance.create({ data });
        });

        res.status(201).json(result);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Failed to create insurance' });
    }
};

// PUT /api/admin/insurance/:id
exports.updateInsurance = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { provider, policyNumber, endDate, documentUrl, uploadedDocumentId, notes } = req.body;

        const updateData = {};
        if (provider) updateData.provider = provider;
        if (policyNumber) updateData.policyNumber = policyNumber;
        if (documentUrl !== undefined) updateData.documentUrl = documentUrl;
        if (uploadedDocumentId !== undefined) updateData.uploadedDocumentId = uploadedDocumentId ? parseInt(uploadedDocumentId) : null;
        if (notes !== undefined) updateData.notes = notes;
        
        if (endDate) {
            const end = new Date(endDate);
            updateData.endDate = end;
            
            // Re-evaluate status
            const current = await prisma.insurance.findUnique({ where: { id } });
            if (current && ['ACTIVE', 'EXPIRING_SOON', 'EXPIRED'].includes(current.status)) {
                const today = new Date();
                today.setHours(0,0,0,0);
                const diffDays = Math.ceil((end - today) / (1000 * 60 * 60 * 24));
                if (diffDays <= 0) {
                    updateData.status = 'EXPIRED';
                } else if (diffDays <= 15) {
                    updateData.status = 'EXPIRING_SOON';
                } else {
                    updateData.status = 'ACTIVE';
                }
            }
        }

        const updated = await prisma.insurance.update({
            where: { id },
            data: updateData
        });

        res.json(updated);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Failed to update insurance' });
    }
};
