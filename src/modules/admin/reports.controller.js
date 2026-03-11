const prisma = require('../../config/prisma');
const { generateReportPDF } = require('../../utils/pdf.utils');

// GET /api/admin/reports/:id/download
exports.downloadReportPDF = async (req, res) => {
    try {
        const { id } = req.params;
        // Basic implementation, can be expanded to fetch real data
        generateReportPDF(id, res);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Error generating PDF' });
    }
};

// GET /api/admin/reports
exports.getReports = async (req, res) => {
    try {
        // --- KPI Calculation ---

        // Total Revenue (All Payments Received)
        const allInvoices = await prisma.invoice.findMany({ where: { paidAmount: { gt: 0 } } });
        const totalRevenue = allInvoices.reduce((sum, i) => sum + parseFloat(i.paidAmount), 0);


        // Occupancy Rate
        const totalUnits = await prisma.unit.count();
        const occupiedUnits = await prisma.unit.count({ where: { status: { not: 'Vacant' } } });
        const occupancyRate = totalUnits > 0 ? Math.round((occupiedUnits / totalUnits) * 100) : 0;

        // Active Leases
        const activeLeases = await prisma.lease.count({ where: { status: 'Active' } });

        // Outstanding Dues (Total Remaining Balance)
        const unpaidInvoices = await prisma.invoice.findMany({
            where: {
                status: { notIn: ['paid', 'draft'] }
            }
        });
        const outstandingDues = unpaidInvoices.reduce((sum, i) => sum + parseFloat(i.balanceDue), 0);



        // --- Graphs Data ---

        // Monthly Revenue (Aggregate by month string using paidAmount)
        const monthlyMap = {};
        allInvoices.forEach(inv => {
            if (!monthlyMap[inv.month]) monthlyMap[inv.month] = 0;
            monthlyMap[inv.month] += parseFloat(inv.paidAmount);
        });


        // Lease Type Distribution
        // We need to fetch units to check bedrooms count for lease type heuristic
        const leases = await prisma.lease.findMany({
            where: { status: 'Active' },
            include: { unit: true }
        });

        let fullUnitCount = 0;
        let bedroomCount = 0;
        leases.forEach(l => {
            if (l.unit.rentalMode === 'FULL_UNIT') fullUnitCount++;
            else bedroomCount++;
        });

        // --- Top Performing Properties ---
        const properties = await prisma.property.findMany({
            include: {
                units: {
                    include: {
                        leases: { where: { status: 'Active' } },
                        invoices: { where: { status: 'paid' } }
                    }
                }
            }
        });

        const propertyPerformance = properties.map(p => {
            const revenue = p.units.reduce((rSum, u) => {
                return rSum + u.invoices.reduce((iSum, i) => iSum + parseFloat(i.paidAmount), 0);
            }, 0);

            const pTotalUnits = p.units.length;
            const pOccupied = p.units.filter(u => u.status !== 'Vacant').length;
            const pOccupancy = pTotalUnits > 0 ? Math.round((pOccupied / pTotalUnits) * 100) : 0;

            return {
                name: p.name,
                revenue,
                occupancy: pOccupancy
            };
        }).sort((a, b) => b.revenue - a.revenue).slice(0, 5); // Top 5

        // Tenant vs Resident counts
        const tenantCount = await prisma.user.count({
            where: { role: 'TENANT', type: { in: ['INDIVIDUAL', 'COMPANY'] } }
        });
        const residentCount = await prisma.user.count({
            where: { role: 'TENANT', type: 'RESIDENT' }
        });

        res.json({
            kpi: {
                totalRevenue,
                occupancyRate,
                activeLeases,
                outstandingDues,
                tenantCount,
                residentCount
            },
            monthlyRevenue: Object.keys(monthlyMap).map(k => ({ month: k, amount: monthlyMap[k] })),
            leaseDistribution: { fullUnit: fullUnitCount, bedroom: bedroomCount },
            topProperties: propertyPerformance
        });

    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

// GET /api/admin/reports/rent-roll
exports.getRentRoll = async (req, res) => {
    try {
        const units = await prisma.unit.findMany({
            include: {
                property: true,
                bedroomsList: true,
                leases: {
                    where: { status: 'Active' },
                    include: { tenant: true }
                }
            }
        });

        let rentRollArray = [];
        let totalUnits = 0;
        let occupiedUnits = 0;
        let vacantUnits = 0;
        let occupiedBedrooms = 0;
        let vacantBedrooms = 0;
        let totalMonthlyRent = 0;

        units.forEach(u => {
            totalUnits++;
            const isFullUnit = u.rentalMode === 'FULL_UNIT';
            if (isFullUnit) {
                // Determine if there is an active lease
                const activeLease = u.leases[0];
                if (activeLease) {
                    occupiedUnits++;
                    const rent = activeLease.monthlyRent ? parseFloat(activeLease.monthlyRent.toString()) : 0;
                    totalMonthlyRent += rent;

                    rentRollArray.push({
                        id: `unit-${u.id}`,
                        buildingName: u.property?.name || 'N/A',
                        leaseType: 'Full Unit',
                        unitNumber: u.unitNumber || u.name,
                        bedroomNumber: '-',
                        tenantName: activeLease.tenant ? (activeLease.tenant.companyName || `${activeLease.tenant.firstName || ''} ${activeLease.tenant.lastName || ''}`.trim() || activeLease.tenant.name || '-') : '-',
                        startDate: activeLease.startDate,
                        endDate: activeLease.endDate,
                        monthlyRent: rent,
                        status: 'Occupied'
                    });
                } else {
                    vacantUnits++;
                    rentRollArray.push({
                        id: `unit-${u.id}`,
                        buildingName: u.property?.name || 'N/A',
                        leaseType: 'Full Unit',
                        unitNumber: u.unitNumber || u.name,
                        bedroomNumber: '-',
                        tenantName: '-',
                        startDate: null,
                        endDate: null,
                        monthlyRent: 0,
                        status: 'Vacant'
                    });
                }
            } else {
                // BEDROOM_WISE mode
                let unitIsFullyVacant = true;
                let unitIsFullyOccupied = true;

                if (u.bedroomsList.length === 0) {
                    vacantUnits++;
                } else {
                    u.bedroomsList.forEach(bedroom => {
                        // Priority 1: Check if there's an active lease specifically for this bedroom
                        const bLease = u.leases.find(l =>
                            l.bedroomId === bedroom.id ||
                            (l.tenant && l.tenant.bedroomId === bedroom.id)
                        );

                        // Priority 2: Check if there's an active FULL_UNIT lease for the entire unit
                        const unitLease = u.leases.find(l => l.leaseType === 'FULL_UNIT');

                        const activeLease = bLease || unitLease;

                        if (activeLease || bedroom.status === 'Occupied') {
                            occupiedBedrooms++;
                            unitIsFullyVacant = false;

                            if (activeLease) {
                                const rent = activeLease.monthlyRent ? parseFloat(activeLease.monthlyRent.toString()) : 0;
                                // Only count rent towards total if it's a bedroom-specific lease
                                // OR if it's a full unit lease but we're at the first bedroom (to avoid double counting)
                                if (bLease || (unitLease && bedroom === u.bedroomsList[0])) {
                                    totalMonthlyRent += rent;
                                }

                                rentRollArray.push({
                                    id: `bed-${bedroom.id}`,
                                    buildingName: u.property?.name || 'N/A',
                                    leaseType: 'Bedroom Lease',
                                    unitNumber: u.unitNumber || u.name,
                                    bedroomNumber: bedroom.bedroomNumber,
                                    tenantName: activeLease.tenant ? (activeLease.tenant.companyName || `${activeLease.tenant.firstName || ''} ${activeLease.tenant.lastName || ''}`.trim() || activeLease.tenant.name || '-') : '-',
                                    startDate: activeLease.startDate,
                                    endDate: activeLease.endDate,
                                    monthlyRent: rent,
                                    status: 'Occupied'
                                });
                            } else {
                                rentRollArray.push({
                                    id: `bed-${bedroom.id}`,
                                    buildingName: u.property?.name || 'N/A',
                                    leaseType: 'Bedroom Lease',
                                    unitNumber: u.unitNumber || u.name,
                                    bedroomNumber: bedroom.bedroomNumber,
                                    tenantName: 'Unknown (Occupied)',
                                    startDate: null,
                                    endDate: null,
                                    monthlyRent: 0,
                                    status: 'Occupied'
                                });
                            }
                        } else {
                            vacantBedrooms++;
                            unitIsFullyOccupied = false;
                            rentRollArray.push({
                                id: `bed-${bedroom.id}`,
                                buildingName: u.property?.name || 'N/A',
                                leaseType: 'Bedroom Lease',
                                unitNumber: u.unitNumber || u.name,
                                bedroomNumber: bedroom.bedroomNumber,
                                tenantName: '-',
                                startDate: null,
                                endDate: null,
                                monthlyRent: parseFloat(bedroom.rentAmount || 0),
                                status: 'Vacant'
                            });
                        }
                    });

                    if (unitIsFullyVacant) vacantUnits++;
                    else if (unitIsFullyOccupied) occupiedUnits++;
                    else occupiedUnits++; // Partially occupied is counted as occupied unit broadly
                }
            }
        });

        res.json({
            summary: {
                totalUnits,
                occupiedUnits,
                occupiedBedrooms,
                vacantUnits,
                vacantBedrooms,
                totalMonthlyRent
            },
            rentRoll: rentRollArray
        });

    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error generating rent roll' });
    }
};
