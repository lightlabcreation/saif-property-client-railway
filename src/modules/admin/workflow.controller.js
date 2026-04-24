const prisma = require('../../config/prisma');
const workflowService = require('../../services/workflow.service');

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
                        invoices: { where: { category: 'SECURITY_DEPOSIT' } }
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
            
            // Layer 2 Checks (Only if lease exists)
            const hasInsurance = mi.lease?.insurances?.some(i => i.status === 'ACTIVE') || false;
            const depositPaid = mi.lease?.invoices?.every(inv => inv.status === 'paid') || false;
            
            let currentStatus = mi.status;

            // Transition: Blocked -> Missing Requirements (if unit becomes ACTIVE)
            if (currentStatus === 'PENDING' || currentStatus === 'BLOCKED_IN_PREPARATION' || currentStatus === 'BLOCKED_IN_CONSTRUCTION') {
                if (mi.unit?.unit_status === 'ACTIVE') {
                    currentStatus = 'REQUIREMENTS_PENDING';
                }
            }

            // Transition: Missing Requirements -> Ready for Inspection
            if (currentStatus === 'REQUIREMENTS_PENDING') {
                const reqsMet = mi.lease?.rent_paid && mi.lease?.security_deposit_paid && mi.lease?.insurance_provided && mi.lease?.status === 'Active';
                if (reqsMet || mi.admin_override) {
                    currentStatus = 'READY_FOR_MOVE_IN';
                }
            }

            return {
                ...mi,
                status: currentStatus,
                daysRemaining: diffDays,
                urgency: diffDays < 0 ? 'OVERDUE' : diffDays <= 7 ? 'HIGH' : 'NORMAL',
                requirements: {
                    insurance: hasInsurance,
                    deposit: depositPaid
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

module.exports = {
    getMoveOutDashboard,
    getMoveInDashboard,
    approveMoveOut,
    overrideMoveIn,
    getUnitHistory
};
