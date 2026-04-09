const prisma = require('../../config/prisma');

exports.getBuildings = async (req, res) => {
    try {
        const properties = await prisma.property.findMany({
            select: { id: true, name: true },
            orderBy: { name: 'asc' }
        });
        res.json(properties);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error fetching buildings' });
    }
};

exports.getReadinessStats = async (req, res) => {
    try {
        const { propertyId } = req.query;
        const where = {};
        if (propertyId) where.propertyId = parseInt(propertyId);

        const units = await prisma.unit.findMany({ where });

        const totalUnits = units.length;
        const readyForLeasing = units.filter(u => u.ready_for_leasing).length;
        const reservedUnits = units.filter(u => u.reserved_flag).length;
        
        const now = new Date();
        now.setHours(0,0,0,0);
        
        const overdueUnits = units.filter(u => {
            const milestones = [
                'gc_delivered', 'gc_deficiencies', 'gc_cleaned', 
                'ffe_installed', 'ose_installed', 'final_cleaning', 'unit_ready'
            ];
            return milestones.some(key => {
                const isCompleted = u[`${key}_completed`];
                const targetDateValue = u[`${key}_target_date`] ? new Date(u[`${key}_target_date`]).getTime() : null;
                return !isCompleted && targetDateValue && targetDateValue < now.getTime();
            });
        }).length;

        res.json({
            totalUnits,
            readyForLeasing,
            reservedUnits,
            overdueUnits
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error fetching readiness stats' });
    }
};

// GET /api/admin/readiness/dashboard
exports.getReadinessDashboard = async (req, res) => {
    try {
        const { propertyId, search, status, page = 1, limit = 15 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const take = parseInt(limit);

        const where = {};
        
        // 1. Property Filter
        if (propertyId && propertyId !== '') {
            where.propertyId = parseInt(propertyId);
        }

        // 2. Status Filter
        if (status) {
            if (['Occupied', 'Available', 'Reserved', 'Unavailable'].includes(status)) {
                where.availability_status = status;
            } else {
                where.unit_status = status;
            }
        }

        // 3. Search Filter
        if (search && search !== 'null' && search !== 'undefined' && search.trim() !== '') {
            const searchVal = search.trim();
            const parts = searchVal.split('-').map(p => p.trim());
            
            const searchOR = [
                { unitNumber: { contains: searchVal } },
                { name: { contains: searchVal } },
                { property: { name: { contains: searchVal } } }
            ];

            // If it looks like a combined identifier (e.g., "93-402")
            if (parts.length >= 2 && parts[0] && parts[1]) {
                searchOR.push({
                    AND: [
                        { property: { civicNumber: { contains: parts[0] } } },
                        { unitNumber: { contains: parts[1] } }
                    ]
                });
            }

            if (where.AND) {
                where.AND.push({ OR: searchOR });
            } else {
                where.AND = [{ OR: searchOR }];
            }
        }

        const total = await prisma.unit.count({ where });
        const units = await prisma.unit.findMany({
            where,
            include: {
                property: true,
                reserved_by_user: true
            },
            skip,
            take,
            orderBy: { createdAt: 'desc' }
        });

        const formatted = units.map(u => {
            // Computed Logic for Days Late
            let daysLate = 0;
            const today = new Date();
            
            const getPendingStepDate = (unit) => {
                if (!unit.gc_delivered_completed) return unit.gc_delivered_target_date;
                if (!unit.gc_deficiencies_completed) return unit.gc_deficiencies_target_date;
                if (!unit.gc_cleaned_completed) return unit.gc_cleaned_target_date;
                if (!unit.ffe_installed_completed) return unit.ffe_installed_target_date;
                if (!unit.ose_installed_completed) return unit.ose_installed_target_date;
                if (!unit.final_cleaning_completed) return unit.final_cleaning_target_date;
                if (!unit.unit_ready_completed) return unit.unit_ready_target_date;
                return null;
            };

            const targetDate = getPendingStepDate(u);
            if (targetDate && new Date(targetDate) < today) {
                const diffTime = Math.abs(today - new Date(targetDate));
                daysLate = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            }

            // Dynamically compute the Status Note / Stage (Matching Client Pattern)
            let dynamicStage = 'Not Started';
            const isFullyReady = u.unit_ready_completed || u.ready_for_leasing || u.unit_status === 'ACTIVE';
            
            const findFirstPending = () => {
                const steps = [
                    { key: 'gc_delivered', label: 'GC Delivered' },
                    { key: 'gc_deficiencies', label: 'GC Deficiencies' },
                    { key: 'gc_cleaned', label: 'GC Cleaned' },
                    { key: 'ffe_installed', label: 'FF&E Installed' },
                    { key: 'ose_installed', label: 'OS&E Installed' },
                    { key: 'final_cleaning', label: 'Final Cleaning' },
                    { key: 'unit_ready', label: 'Unit Ready' }
                ];
                for (const s of steps) {
                    if (!u[`${s.key}_completed`]) return s;
                }
                return null;
            };

            const pendingStep = findFirstPending();
            if (pendingStep) {
                const tDate = u[`${pendingStep.key}_target_date`] ? new Date(u[`${pendingStep.key}_target_date`]) : null;
                const statusSuffix = (tDate && tDate < today.setHours(0,0,0,0)) ? 'Overdue' : 'Pending';
                dynamicStage = `${pendingStep.label} ${statusSuffix}`;
            }

            if (u.reserved_flag) {
                dynamicStage = isFullyReady ? 'Reserved – Ready' : (pendingStep ? `Reserved – Not Ready (${pendingStep.label})` : 'Reserved – Not Ready');
            } else if (isFullyReady) {
                dynamicStage = 'Unit Ready';
            }

            return {
                id: u.id,
                unitNumber: u.unitNumber,
                building: u.property.name,
                unit_status: u.unit_status,
                availability: u.availability_status,
                owner: u.current_owner || 'GC',
                stage: u.status_note || dynamicStage,
                daysLate,
                reserved: u.reserved_flag,
                isActive: u.ready_for_leasing,
                reservedBy: u.reserved_by_user?.name || null,
                moveInDate: u.tentative_move_in_date,
                targetDates: {
                    gc_delivered: u.gc_delivered_target_date,
                    gc_deficiencies: u.gc_deficiencies_target_date,
                    gc_cleaned: u.gc_cleaned_target_date,
                    ffe_installed: u.ffe_installed_target_date,
                    ose_installed: u.ose_installed_target_date,
                    final_cleaning: u.final_cleaning_target_date,
                    unit_ready: u.unit_ready_target_date
                },
                completion: {
                    gc_delivered: u.gc_delivered_completed,
                    gc_deficiencies: u.gc_deficiencies_completed,
                    gc_cleaned: u.gc_cleaned_completed,
                    ffe_installed: u.ffe_installed_completed,
                    ose_installed: u.ose_installed_completed,
                    final_cleaning: u.final_cleaning_completed,
                    unit_ready: u.unit_ready_completed
                }
            };
        });

        res.json({ units: formatted, total });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error fetching readiness dashboard' });
    }
};

// PUT /api/admin/readiness/update-step/:unitId
exports.updateReadinessStep = async (req, res) => {
    try {
        const { unitId } = req.params;
        const { stepKey, completed, completionDate, targetDate, recalculate } = req.body;

        const unit = await prisma.unit.findUnique({
            where: { id: parseInt(unitId) }
        });

        if (!unit) return res.status(404).json({ message: 'Unit not found' });

        const updateData = {};
        updateData[`${stepKey}_completed`] = completed;
        updateData[`${stepKey}_completed_date`] = completed ? (completionDate ? new Date(completionDate) : new Date()) : null;
        if (targetDate) updateData[`${stepKey}_target_date`] = new Date(targetDate);

        // Auto-initialize owner to GC if it's currently N/A or empty
        if (!unit.current_owner || unit.current_owner === 'N/A' || unit.current_owner === 'UNSPECIFIED') {
            updateData.current_owner = 'GC';
        }

        // --- AUTOMATION 1: Strict Sequence Check ---
        const steps = ['gc_delivered', 'gc_deficiencies', 'gc_cleaned', 'ffe_installed', 'ose_installed', 'final_cleaning', 'unit_ready'];
        const stepIndex = steps.indexOf(stepKey);

        if (completed) {
            // Can only complete if previous is done or it's the first step
            if (stepIndex > 0) {
                const prevStep = steps[stepIndex - 1];
                if (!unit[`${prevStep}_completed`] && !unit[`${prevStep}_completed_date`] && !unit[`${prevStep}_actual_date`]) {
                   return res.status(400).json({ message: `Cannot complete ${stepKey} until ${prevStep} is done.` });
                }
            }
        } else {
            // Can only UNCOMPLETE if NEXT step is NOT DONE
            if (stepIndex < steps.length - 1) {
                const nextStep = steps[stepIndex + 1];
                const isNextStepStarted = unit[`${nextStep}_completed`] || unit[`${nextStep}_completed_date`] || unit[`${nextStep}_actual_date`];
                if (isNextStepStarted) {
                    return res.status(400).json({ message: `Cannot undo ${stepKey} because ${nextStep} is already started/complete.` });
                }
            }
        }

        // --- AUTOMATION 2: Owner Switching ---
        if (stepKey === 'gc_cleaned' && completed) {
            updateData.current_owner = 'OPERATIONS';
        } else if (stepKey === 'gc_cleaned' && !completed) {
            updateData.current_owner = 'GC';
        }

        // --- AUTOMATION 3: Step 7 Auto-Complete ---
        if (stepKey === 'final_cleaning' && completed) {
            updateData.unit_ready_completed = true;
            updateData.unit_ready_completed_date = new Date();
        }

        // --- AUTOMATION 4: Target Date Recalculation (Rule 3.3) ---
        if (stepKey === 'gc_delivered' && req.body.recalculate) {
            const settings = await prisma.timelineSetting.findMany();
            const setMap = settings.reduce((acc, s) => ({ ...acc, [s.key]: s.days }), {});
            
            // Use provided targetDate, or existing target_date, or just the completion date
            const baseDate = targetDate ? new Date(targetDate) : (unit.gc_delivered_target_date ? new Date(unit.gc_delivered_target_date) : new Date(updateData.gc_delivered_completed_date));
            
            const defDays = setMap['gc_to_deficiencies'] || 5;
            updateData.gc_deficiencies_target_date = new Date(baseDate.getTime() + (defDays * 24 * 60 * 60 * 1000));
            
            const cleanDays = setMap['deficiencies_to_cleaned'] || 5;
            updateData.gc_cleaned_target_date = new Date(updateData.gc_deficiencies_target_date.getTime() + (cleanDays * 24 * 60 * 60 * 1000));
            
            const ffeDays = setMap['cleaned_to_ffe'] || 10;
            updateData.ffe_installed_target_date = new Date(updateData.gc_cleaned_target_date.getTime() + (ffeDays * 24 * 60 * 60 * 1000));
            
            const oseDays = setMap['ffe_to_ose'] || 7;
            updateData.ose_installed_target_date = new Date(updateData.ffe_installed_target_date.getTime() + (oseDays * 24 * 60 * 60 * 1000));
            
            const finalDays = setMap['ose_to_final'] || 5;
            updateData.final_cleaning_target_date = new Date(updateData.ose_installed_target_date.getTime() + (finalDays * 24 * 60 * 60 * 1000));
            
            const readyDays = setMap['final_to_ready'] || 2;
            updateData.unit_ready_target_date = new Date(updateData.final_cleaning_target_date.getTime() + (readyDays * 24 * 60 * 60 * 1000));
        }

        // --- AUTOMATION 5: Final Activation Check (Rule 3.1) ---
        const isPhysicallyReady = (stepKey === 'final_cleaning' && completed) || unit.unit_ready_completed;
        const isManuallyApproved = (stepKey === 'activate' ? completed : unit.ready_for_leasing);
        
        if (isPhysicallyReady && isManuallyApproved) {
            updateData.unit_status = 'ACTIVE';
            updateData.availability_status = unit.reserved_flag ? 'Reserved' : 'Available';
        }

        // Update Unit
        const updatedUnit = await prisma.unit.update({
            where: { id: parseInt(unitId) },
            data: updateData
        });

        res.json(updatedUnit);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error updating workflow step' });
    }
};

// GET /api/admin/readiness/settings
exports.getSettings = async (req, res) => {
    try {
        let settings = await prisma.timelineSetting.findMany();
        
        // Smart Default Seeding if empty
        if (settings.length === 0) {
            const defaults = [
                { key: 'gc_to_deficiencies', days: 5 },
                { key: 'deficiencies_to_cleaned', days: 5 },
                { key: 'cleaned_to_ffe', days: 10 },
                { key: 'ffe_to_ose', days: 7 },
                { key: 'ose_to_final', days: 5 },
                { key: 'final_to_ready', days: 2 }
            ];
            
            for (const d of defaults) {
                await prisma.timelineSetting.upsert({
                    where: { key: d.key },
                    update: {},
                    create: d
                });
            }
            settings = await prisma.timelineSetting.findMany();
        }
        
        res.json(settings);
    } catch (error) {
        res.status(500).json({ message: 'Error fetching settings' });
    }
};

// POST /api/admin/readiness/settings
exports.updateSettings = async (req, res) => {
    try {
        const { settings } = req.body; // Array of { key, days }
        for (const s of settings) {
            await prisma.timelineSetting.upsert({
                where: { key: s.key },
                update: { days: parseInt(s.days) },
                create: { key: s.key, days: parseInt(s.days) }
            });
        }
        res.json({ message: 'Settings updated' });
    } catch (error) {
        res.status(500).json({ message: 'Error updating settings' });
    }
};

exports.activateUnit = async (req, res) => {
    try {
        const { unitId } = req.params;
        const { ready } = req.body;
        const updateData = {
            ready_for_leasing: ready,
            unit_status: ready ? 'ACTIVE' : 'INACTIVE',
            availability_status: ready ? 'Available' : 'Unavailable'
        };
        const updated = await prisma.unit.update({
            where: { id: parseInt(unitId) },
            data: updateData
        });
        res.json(updated);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error activating unit' });
    }
};
