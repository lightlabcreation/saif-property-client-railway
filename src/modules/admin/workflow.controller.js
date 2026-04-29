const prisma = require('../../config/prisma');
const workflowService = require('../../services/workflow.service');
const { generateDashboardPDF } = require('../../utils/pdf.utils');

/**
 * Workflow Controller
 * Manages Move-In/Out Dashboards and Overrides
 */

const getMoveOutDashboard = async (req, res) => {
    try {
        const moveOuts = await prisma.moveOut.findMany({
            include: {
                unit: true,
                lease: { include: { tenant: true } },
                manager: { select: { id: true, name: true } }
            },
            orderBy: { targetDate: 'asc' }
        });

        // Compute urgency
        const data = moveOuts.map(mo => {
            const today = new Date();
            const target = new Date(mo.targetDate);
            const diffDays = Math.ceil((target - today) / (1000 * 60 * 60 * 24));
            return {
                ...mo,
                daysRemaining: diffDays,
                urgency: diffDays < 0 ? 'OVERDUE' : diffDays <= 7 ? 'HIGH' : 'NORMAL'
            };
        });

        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getMoveInDashboard = async (req, res) => {
    try {
        const moveIns = await prisma.moveIn.findMany({
            include: {
                unit: { include: { reserved_by_user: true } },
                lease: { 
                    include: { 
                        tenant: true,
                        insurances: { orderBy: { createdAt: 'desc' }, take: 1 },
                        invoices: { 
                            where: { 
                                category: { in: ['SECURITY_DEPOSIT', 'RENT'] } 
                            } 
                        } 
                    } 
                },
                overrideUser: { select: { id: true, name: true } }
            },
            orderBy: { targetDate: 'asc' }
        });

        // Add blocking status logic
        const data = moveIns.map(mi => {
            const today = new Date();
            const target = new Date(mi.targetDate);
            const diffDays = Math.ceil((target - today) / (1000 * 60 * 60 * 24));
            
            const dbInsurance = mi.lease?.insurances?.some(i => i.status === 'ACTIVE') || false;
            const dbDeposit = mi.lease?.invoices?.filter(inv => inv.category === 'SECURITY_DEPOSIT').every(inv => inv.status === 'paid') && (mi.lease?.invoices?.some(inv => inv.category === 'SECURITY_DEPOSIT') || false);
            const dbRent = mi.lease?.invoices?.filter(inv => inv.category === 'RENT').some(inv => inv.status === 'paid');
            
            // 2. Requirements from JSON field (Manual Overrides)
            const missingItems = Array.isArray(mi.missingItems) ? mi.missingItems : ['Rent', 'Deposit', 'Insurance'];
            
            // 3. Final logic: True if manually checked OR if record exists in DB
            const rentPaid = !missingItems.includes('Rent') || dbRent;
            const depositPaid = !missingItems.includes('Deposit') || dbDeposit;
            const insuranceProvided = !missingItems.includes('Insurance') || dbInsurance;
            
            let currentStatus = mi.status;

            // Transition: Blocked -> Missing Requirements (if unit becomes ACTIVE or is marked ready)
            if (currentStatus === 'PENDING' || currentStatus === 'BLOCKED_IN_PREPARATION' || currentStatus === 'BLOCKED_IN_CONSTRUCTION') {
                if (mi.unit?.unit_status === 'ACTIVE' || mi.unit?.ready_for_leasing || mi.unit?.unit_ready_completed) {
                    currentStatus = 'REQUIREMENTS_PENDING';
                }
            }

            // Transition: Missing Requirements -> Ready for Move-In
            if (currentStatus === 'REQUIREMENTS_PENDING') {
                const reqsMet = rentPaid && depositPaid && insuranceProvided;
                if (reqsMet || mi.overrideFlag) {
                    currentStatus = 'READY_FOR_MOVE_IN';
                }
            }

            return {
                ...mi,
                status: currentStatus,
                daysRemaining: diffDays,
                urgency: diffDays < 0 ? 'OVERDUE' : diffDays <= 7 ? 'HIGH' : 'NORMAL',
                requirements: {
                    rent: rentPaid,
                    deposit: depositPaid,
                    insurance: insuranceProvided
                }
            };
        });

        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const approveMoveOut = async (req, res) => {
    try {
        const { id } = req.params;
        const managerId = req.user.id;

        const moveOut = await prisma.moveOut.update({
            where: { id: parseInt(id) },
            data: {
                status: 'COMPLETED',
                managerApproved: true,
                managerId: managerId,
                actualDate: new Date()
            }
        });

        // Trigger transition to Unit Prep
        await workflowService.updateUnitPrepStage(moveOut.unitId, {
            stage: 'PENDING_TICKETS',
            userId: managerId
        });

        res.json({ success: true, data: moveOut });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const overrideMoveIn = async (req, res) => {
    try {
        const { id } = req.params;
        const { reason, missingItems } = req.body;
        const userId = req.user.id;

        const result = await workflowService.overrideMoveIn(parseInt(id), userId, {
            reason,
            missingItems
        });

        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getUnitHistory = async (req, res) => {
    try {
        const { unitId } = req.params;
        const history = await prisma.unitHistory.findMany({
            where: { unitId: parseInt(unitId) },
            include: { user: { select: { name: true, role: true } } },
            orderBy: { timestamp: 'desc' }
        });
        res.json({ success: true, data: history });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const approveMoveIn = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const result = await workflowService.completeMoveIn(parseInt(id), userId);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const confirmMoveOut = async (req, res) => {
    try {
        const { id } = req.params;
        const moveOut = await prisma.moveOut.update({
            where: { id: parseInt(id) },
            data: { status: 'CONFIRMED' }
        });
        res.json({ success: true, data: moveOut });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const completeMoveOut = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        // Uses the correct flow that enforces Mandatory Inspection Rule and creates Prep Tasks
        await workflowService.completeMoveOutFlow(parseInt(id), userId);

        res.json({ success: true, message: 'Move-Out flow completed successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getUnitPrepDashboard = async (req, res) => {
    try {
        // Fetch units that are in preparation (usually marked as Vacant after move-out or newly construction)
        const units = await prisma.unit.findMany({
            where: {
                // We show units that are in any prep stage
                current_stage: {
                    in: ['PENDING_TICKETS', 'READY_FOR_CLEANING', 'CLEANING_IN_PROGRESS', 'CLEANING_COMPLETED']
                }
            },
            include: {
                property: true,
                prepTasks: {
                    include: {
                        // Include the ticket if it's a deficiency task
                        // Wait, ticket is not a relation in schema but a ticketId field?
                        // Let me check schema again.
                    }
                },
                leases: {
                    where: { status: 'Active' },
                    include: { tenant: true }
                },
                // Also find the next reservation if any
                reserved_by_user: true
            }
        });

        // For each unit, check if it's blocked by required tickets
        const dashboardData = await Promise.all(units.map(async (unit) => {
            // Get all open tickets for this unit
            const openTickets = await prisma.ticket.findMany({
                where: {
                    unitId: unit.id,
                    status: 'Open'
                }
            });

            const requiredTickets = openTickets.filter(t => t.isRequired);
            const hasRequiredTickets = requiredTickets.length > 0;

            // Determine if unit should auto-progress from PENDING_TICKETS to READY_FOR_CLEANING
            let effectiveStage = unit.current_stage;
            if (effectiveStage === 'PENDING_TICKETS' && !hasRequiredTickets) {
                // Auto-progress
                effectiveStage = 'READY_FOR_CLEANING';
                await prisma.unit.update({
                    where: { id: unit.id },
                    data: { current_stage: 'READY_FOR_CLEANING' }
                });
            }

            return {
                ...unit,
                hasRequiredTickets,
                requiredTicketsCount: requiredTickets.length,
                totalOpenTickets: openTickets.length,
                current_stage: effectiveStage
            };
        }));

        res.json({ success: true, data: dashboardData });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateUnitPrepStage = async (req, res) => {
    try {
        const { unitId } = req.params;
        const { nextStage } = req.body;

        const unit = await prisma.unit.findUnique({
            where: { id: parseInt(unitId) }
        });

        if (!unit) return res.status(404).json({ success: false, message: 'Unit not found' });

        // Blocking Logic (3.5 & 3.8): Cleaning only starts AFTER required tickets completed
        if (nextStage === 'CLEANING_IN_PROGRESS' || nextStage === 'READY_FOR_CLEANING') {
            const requiredTickets = await prisma.ticket.findMany({
                where: {
                    unitId: parseInt(unitId),
                    status: 'Open',
                    isRequired: true
                }
            });

            if (requiredTickets.length > 0) {
                return res.status(400).json({ 
                    success: false, 
                    message: `Blocked: ${requiredTickets.length} required tickets must be completed first.` 
                });
            }
        }

        // Final State Logic (3.9)
        const updateData = { current_stage: nextStage };
        if (nextStage === 'UNIT_READY') {
            updateData.availability_status = 'Available';
            updateData.ready_for_leasing = true;
            updateData.status_note = 'Ready for Move-In';
            // We keep current_stage as UNIT_READY or set to null to remove from dashboard
        }

        const updatedUnit = await prisma.unit.update({
            where: { id: parseInt(unitId) },
            data: updateData
        });

        // Add history log
        await prisma.unitHistory.create({
            data: {
                unitId: parseInt(unitId),
                userId: req.user.id,
                action: `PREP_STAGE_CHANGED: ${nextStage}`,
                newStatus: nextStage === 'UNIT_READY' ? 'Available' : unit.availability_status
            }
        });

        res.json({ success: true, data: updatedUnit });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const triggerMoveOut = async (req, res) => {
    try {
        let leaseIdToUse = parseInt(req.params.leaseId);
        
        // For testing purposes, if leaseId is 1 (dummy), find the first active lease
        if (leaseIdToUse === 1) {
            const activeLease = await prisma.lease.findFirst({
                where: { status: 'Active' },
                orderBy: { createdAt: 'desc' }
            });
            
            if (!activeLease) {
                return res.status(404).json({ success: false, message: 'No active lease found to trigger move-out.' });
            }
            leaseIdToUse = activeLease.id;
        }

        const result = await workflowService.initMoveOutWorkflow(leaseIdToUse);
        res.json({ success: true, message: 'Move-out flow triggered successfully', data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const cancelMoveOut = async (req, res) => {
    try {
        const { leaseId } = req.params;
        await workflowService.cancelMoveOutFlow(parseInt(leaseId), req.user.id);
        res.json({ success: true, message: 'Move-Out cancelled successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const exportMoveInPDF = async (req, res) => {
    try {
        const moveIns = await prisma.moveIn.findMany({
            include: {
                unit: true,
                lease: { include: { tenant: true } }
            },
            orderBy: { targetDate: 'asc' }
        });
        generateDashboardPDF('Move-In Dashboard Report', moveIns, res);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const exportMoveOutPDF = async (req, res) => {
    try {
        const moveOuts = await prisma.moveOut.findMany({
            include: {
                unit: true,
                lease: { include: { tenant: true } }
            },
            orderBy: { targetDate: 'asc' }
        });
        generateDashboardPDF('Move-Out Dashboard Report', moveOuts, res);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const exportUnitPrepPDF = async (req, res) => {
    try {
        const units = await prisma.unit.findMany({
            where: {
                current_stage: {
                    in: ['PENDING_TICKETS', 'READY_FOR_CLEANING', 'CLEANING_IN_PROGRESS', 'CLEANING_COMPLETED', 'UNIT_READY']
                }
            },
            include: { 
                property: true,
                leases: {
                    where: { status: 'Active' },
                    include: { tenant: true }
                }
            }
        });
        
        const dataForPDF = units.map(u => ({
            unit: { name: u.unitNumber },
            lease: {
                tenant: {
                    name: u.leases?.[0]?.tenant?.name || 'Vacant'
                }
            },
            status: u.current_stage,
            createdAt: new Date()
        }));

        generateDashboardPDF('Unit Preparation Report', dataForPDF, res);
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const toggleMoveInRequirement = async (req, res) => {
    try {
        const { moveInId } = req.params;
        const { requirement, completed } = req.body;
        const result = await workflowService.updateMoveInRequirement(parseInt(moveInId), { requirement, completed });
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    exportMoveInPDF,
    exportMoveOutPDF,
    exportUnitPrepPDF,
    getMoveOutDashboard,
    getMoveInDashboard,
    approveMoveOut,
    overrideMoveIn,
    approveMoveIn,
    getUnitHistory,
    triggerMoveOut,
    confirmMoveOut,
    completeMoveOut,
    cancelMoveOut,
    getUnitPrepDashboard,
    updateUnitPrepStage,
    toggleMoveInRequirement
};
