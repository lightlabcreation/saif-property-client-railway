const prisma = require('../../config/prisma');

exports.getRevenueStats = async (req, res) => {
    try {
        const { ownerId } = req.query;
        console.log('Revenue Stats - Received ownerId:', ownerId);
        const parsedOwnerId = ownerId && ownerId !== 'null' && ownerId !== '' ? parseInt(ownerId) : null;

        let propertyIds = [];
        if (parsedOwnerId) {
            const ownerProperties = await prisma.property.findMany({
                where: {
                    owners: {
                        some: { id: parsedOwnerId }
                    }
                },
                select: { id: true }
            });
            propertyIds = ownerProperties.map(p => p.id);
        }

        // Use unitFilter correctly so global view (no owner) is not filtered to empty set
        const unitFilter = parsedOwnerId ? { propertyId: { in: propertyIds } } : {};

        // Projected Revenue: Sum of monthlyRent across all Active leases
        const leaseAgg = await prisma.lease.aggregate({
            where: {
                status: 'Active',
                unit: unitFilter
            },
            _sum: { monthlyRent: true }
        });
        const projectedRevenue = parseFloat(leaseAgg._sum.monthlyRent) || 0;

        // Fetch all paid invoices for Actual Revenue and breakdowns
        const [invoices, refunds] = await Promise.all([
          prisma.invoice.findMany({
              where: {
                  paidAmount: { gt: 0 },
                  unit: unitFilter
              },
              include: { unit: { include: { property: true } } }
          }),
          prisma.refundAdjustment.findMany({
              where: {
                  status: 'Completed',
                  unit: unitFilter
              },
              include: { unit: { include: { property: true } } }
          })
        ]);

        // Helper to standardize month keys (e.g., "March 2026")
        const getMonthKey = (dateInput) => {
            const d = new Date(dateInput);
            if (isNaN(d.getTime())) return dateInput; // Fallback to raw string
            return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
        };

        let actualRevenue = 0;
        let actualRent = 0;
        let actualDeposit = 0;
        let actualServiceFees = 0;
        const propertyMap = {};   // { propName: { amount, rent, deposit, serviceFees, monthly: { month: {...} } } }
        const monthlyMap = {};    // { month: { amount, rent, deposit, serviceFees } }

        invoices.forEach(inv => {
            const amount = parseFloat(inv.paidAmount) || 0;
            actualRevenue += amount;

            const desc = (inv.description || '').toLowerCase();
            let type = 'Rent';
            if (inv.category === 'SERVICE') {
                if (desc.includes('deposit')) {
                    type = 'Deposit';
                    actualDeposit += amount;
                } else {
                    type = 'ServiceFees';
                    actualServiceFees += amount;
                }
            } else {
                actualRent += amount;
            }

            // Breakdown by Property (cumulative + monthly)
            const propName = inv.unit?.property?.name || 'Other Building';
            if (!propertyMap[propName]) propertyMap[propName] = { amount: 0, rent: 0, deposit: 0, serviceFees: 0, monthly: {} };
            propertyMap[propName].amount += amount;
            if (type === 'Rent') propertyMap[propName].rent += amount;
            else if (type === 'Deposit') propertyMap[propName].deposit += amount;
            else if (type === 'ServiceFees') propertyMap[propName].serviceFees += amount;

            // Monthly breakdown per property
            const mon = getMonthKey(inv.month);
            if (!propertyMap[propName].monthly[mon]) propertyMap[propName].monthly[mon] = { amount: 0, rent: 0, deposit: 0, serviceFees: 0 };
            propertyMap[propName].monthly[mon].amount += amount;
            if (type === 'Rent') propertyMap[propName].monthly[mon].rent += amount;
            else if (type === 'Deposit') propertyMap[propName].monthly[mon].deposit += amount;
            else if (type === 'ServiceFees') propertyMap[propName].monthly[mon].serviceFees += amount;

            // Global monthly breakdown
            if (!monthlyMap[mon]) monthlyMap[mon] = { amount: 0, rent: 0, deposit: 0, serviceFees: 0 };
            monthlyMap[mon].amount += amount;
            if (type === 'Rent') monthlyMap[mon].rent += amount;
            else if (type === 'Deposit') monthlyMap[mon].deposit += amount;
            else if (type === 'ServiceFees') monthlyMap[mon].serviceFees += amount;
        });

        // Subtract refunds from totals and breakdowns
        refunds.forEach(ref => {
          const amount = parseFloat(ref.amount) || 0;
          actualRevenue -= amount;
          
          let type = 'Rent';
          const rType = ref.type.toLowerCase();
          if (rType.includes('deposit')) {
            type = 'Deposit';
            actualDeposit -= amount;
          } else if (rType.includes('adjustment')) {
            type = 'ServiceFees';
            actualServiceFees -= amount;
          } else {
            type = 'Rent';
            actualRent -= amount;
          }

          const propName = ref.unit?.property?.name || 'Other Building';
          if (propertyMap[propName]) {
            propertyMap[propName].amount -= amount;
            if (type === 'Rent') propertyMap[propName].rent -= amount;
            else if (type === 'Deposit') propertyMap[propName].deposit -= amount;
            else if (type === 'ServiceFees') propertyMap[propName].serviceFees -= amount;
          }

          const mon = getMonthKey(ref.date);
          if (monthlyMap[mon]) {
            monthlyMap[mon].amount -= amount;
            if (type === 'Rent') monthlyMap[mon].rent -= amount;
            else if (type === 'Deposit') monthlyMap[mon].deposit -= amount;
            else if (type === 'ServiceFees') monthlyMap[mon].serviceFees -= amount;
          }

          if (propertyMap[propName] && propertyMap[propName].monthly[mon]) {
            propertyMap[propName].monthly[mon].amount -= amount;
            if (type === 'Rent') propertyMap[propName].monthly[mon].rent -= amount;
            else if (type === 'Deposit') propertyMap[propName].monthly[mon].deposit -= amount;
            else if (type === 'ServiceFees') propertyMap[propName].monthly[mon].serviceFees -= amount;
          }
        });

        const monthSorter = (a, b) => {
            const parseDate = (s) => {
                const [mName, y] = s.split(' ');
                const fullMonthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
                const mIdx = fullMonthNames.indexOf(mName);
                if (mIdx === -1) return 0;
                return new Date(parseInt(y), mIdx).getTime();
            };
            return parseDate(a) - parseDate(b);
        };

        // Sort monthly data chronologically
        const monthlyRevenue = Object.keys(monthlyMap)
            .sort(monthSorter)
            .map(m => ({
                month: m.split(' ')[0].substring(0, 3) + " '" + m.split(' ')[1].slice(-2), // Custom display format "Mar '26"
                amount: monthlyMap[m].amount,
                rent: monthlyMap[m].rent,
                deposit: monthlyMap[m].deposit,
                serviceFees: monthlyMap[m].serviceFees
            }));

        // Build revenueByProperty with monthly breakdown
        const revenueByProperty = Object.keys(propertyMap).map(p => ({
            name: p,
            amount: propertyMap[p].amount,
            rent: propertyMap[p].rent,
            deposit: propertyMap[p].deposit,
            serviceFees: propertyMap[p].serviceFees,
            monthly: Object.keys(propertyMap[p].monthly)
                .sort(monthSorter)
                .map(m => ({
                    month: m.split(' ')[0].substring(0, 3) + " '" + m.split(' ')[1].slice(-2),
                    ...propertyMap[p].monthly[m]
                }))
        }));

        res.json({
            actualRevenue,
            actualRent,
            actualDeposit,
            actualServiceFees,
            projectedRevenue,
            totalRevenue: actualRevenue,
            monthlyRevenue,
            revenueByProperty
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};

exports.getVacancyStats = async (req, res) => {
    try {
        const { ownerId } = req.query;
        console.log('Vacancy Stats - Received ownerId:', ownerId);
        const parsedOwnerId = ownerId && ownerId !== 'null' && ownerId !== '' ? parseInt(ownerId) : null;

        const whereClause = parsedOwnerId ? {
            property: {
                owners: {
                    some: { id: parsedOwnerId }
                }
            }
        } : {};

        // Fetch all units with their bedrooms and active leases
        const units = await prisma.unit.findMany({
            where: whereClause,
            include: {
                property: true,
                bedroomsList: true,
                leases: {
                    where: { status: 'Active' },
                    select: { id: true, bedroomId: true }
                }
            }
        });

        const total = units.length;

        // Global summary: any unit not 'Vacant' is occupied
        const occupied = units.filter(u => u.status !== 'Vacant').length;
        const vacant = units.filter(u => u.status === 'Vacant').length;

        // Breakdown for internal stats (keeping for backwards compat if needed, though they aren't used in main summary above anymore)
        const fullUnitCount = units.filter(u => u.rentalMode === 'FULL_UNIT').length;
        const bedroomWiseCount = units.filter(u => u.rentalMode === 'BEDROOM_WISE').length;

        // Define bedroomWiseUnits for subsequent calculations
        const bedroomWiseUnits = units.filter(u => u.rentalMode === 'BEDROOM_WISE');

        // Vacant bedroom count across all BEDROOM_WISE units
        let totalVacantBedrooms = 0;
        bedroomWiseUnits.forEach(u => {
            const leasedBedroomIds = new Set(u.leases.map(l => l.bedroomId).filter(Boolean));
            const vacantBedrooms = u.bedroomsList.filter(b => b.status === 'Vacant' || !leasedBedroomIds.has(b.id)).length;
            totalVacantBedrooms += vacantBedrooms;
        });

        // Vacancy by Building — distinguish FULL_UNIT vs BEDROOM_WISE (Issues 6 & 7)
        const buildingStats = {};
        units.forEach(u => {
            const propName = u.property?.name || 'Other';
            if (!buildingStats[propName]) buildingStats[propName] = {
                total: 0,
                vacant: 0,
                occupied: 0,
                fullUnitVacant: 0,
                vacantBedrooms: 0,
                hasBedroomWise: false
            };
            buildingStats[propName].total++;

            if (u.rentalMode === 'FULL_UNIT') {
                if (u.status === 'Vacant') {
                    buildingStats[propName].vacant++;
                    buildingStats[propName].fullUnitVacant++;
                } else {
                    buildingStats[propName].occupied++;
                }
            } else {
                // BEDROOM_WISE
                buildingStats[propName].hasBedroomWise = true;
                if (u.leases.length === 0) {
                    buildingStats[propName].vacant++;
                } else {
                    buildingStats[propName].occupied++;
                    // Count vacant bedrooms
                    const leasedBedroomIds = new Set(u.leases.map(l => l.bedroomId).filter(Boolean));
                    const vBedrooms = u.bedroomsList.filter(b => b.status === 'Vacant' || !leasedBedroomIds.has(b.id)).length;
                    buildingStats[propName].vacantBedrooms += vBedrooms;
                }
            }
        });

        const vacancyByBuilding = Object.keys(buildingStats).map(p => ({
            name: p,
            vacant: buildingStats[p].vacant,
            occupied: buildingStats[p].occupied,
            total: buildingStats[p].total,
            vacantBedrooms: buildingStats[p].vacantBedrooms,
            hasBedroomWise: buildingStats[p].hasBedroomWise
        }));

        res.json({
            total,
            vacant,
            occupied,
            totalVacantBedrooms,
            fullUnitCount,
            bedroomWiseCount,
            vacancyByBuilding
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};
