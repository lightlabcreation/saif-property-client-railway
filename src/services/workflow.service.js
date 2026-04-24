const prisma = require('../config/prisma');

/**
 * Workflow Service
 * Handles business logic for Move-In, Move-Out, and Unit Preparation
 * All critical operations use Prisma Transactions for data integrity.
 */

/**
 * Initialize Move-Out Workflow
 * Triggered 30 days before lease end or manually by Admin
 */
const initMoveOutWorkflow = async (leaseId, tx = prisma) => {
    return await tx.$transaction(async (pTx) => {
        const lease = await pTx.lease.findUnique({
            where: { id: leaseId },
            include: { unit: true }
        });

        if (!lease) throw new Error('Lease not found');

        // Check if move-out already exists
        const existingMoveOut = await pTx.moveOut.findUnique({
            where: { leaseId }
        });

        if (existingMoveOut) return existingMoveOut;

        // Create MoveOut record
        const moveOut = await pTx.moveOut.create({
            data: {
                leaseId: lease.id,
                unitId: lease.unitId,
                bedroomId: lease.bedroomId,
                status: 'PENDING',
                targetDate: lease.endDate
            }
        });

        // Log to Unit History
        await pTx.unitHistory.create({
            data: {
                unitId: lease.unitId,
                bedroomId: lease.bedroomId,
                userId: lease.tenantId, // Initial trigger related to tenant
                action: 'MOVE_OUT_INITIATED',
                newStatus: 'PENDING',
                timestamp: new Date()
            }
        });

        return moveOut;
    });
};

/**
 * Complete Inspection & Generate Deficiency Tasks
 */
const completeInspection = async (inspectionId, { signature, noDeficiencyConfirmed, ticketCategory = 'MAINTENANCE' }) => {
    return await prisma.$transaction(async (tx) => {
        const inspection = await tx.inspection.findUnique({
            where: { id: inspectionId },
            include: { responses: { include: { media: true } } }
        });

        if (!inspection) throw new Error('Inspection not found');
        if (inspection.status === 'COMPLETED') throw new Error('Inspection already completed');

        // 1. Update Inspection Record
        const updatedInspection = await tx.inspection.update({
            where: { id: inspectionId },
            data: {
                status: 'COMPLETED',
                tenantSignature: signature,
                noDeficiencyConfirmed,
                completedAt: new Date()
            }
        });

        // 2. Process Deficiency Tickets (if manual ticket creation logic is triggered)
        // Note: Actual ticket creation usually happens via a separate controller call per item,
        // but this service handles the workflow state transition.

        // 3. Workflow Transitions
        const template = await tx.inspectionTemplate.findUnique({ where: { id: updatedInspection.templateId } });
        
        if (template.type === 'MOVE_OUT') {
            await tx.unit.update({
                where: { id: updatedInspection.unitId },
                data: { status_note: 'Blocked - In Preparation' }
            });
        } else if (template.type === 'MOVE_IN') {
            // Find the active MoveIn record for this unit/lease
            const moveIn = await tx.moveIn.findFirst({
                where: { 
                    unitId: updatedInspection.unitId,
                    leaseId: updatedInspection.leaseId || null,
                    status: { notIn: ['INSPECTION_COMPLETED', 'OCCUPIED', 'CANCELLED'] }
                }
            });

            if (moveIn) {
                await tx.moveIn.update({
                    where: { id: moveIn.id },
                    data: { 
                        status: 'INSPECTION_COMPLETED',
                        actualDate: new Date()
                    }
                });
            }
        }

        return updatedInspection;
    });
};

/**
 * Admin Override for Move-In
 */
const overrideMoveIn = async (moveInId, userId, { reason, missingItems }) => {
    return await prisma.$transaction(async (tx) => {
        const moveIn = await tx.moveIn.findUnique({
            where: { id: moveInId },
            include: { unit: true }
        });

        if (!moveIn) throw new Error('Move-In record not found');

        // Ensure missingItems is an array
        let itemsArray = [];
        if (Array.isArray(missingItems)) {
            itemsArray = missingItems;
        } else if (typeof missingItems === 'string' && missingItems.trim() !== '') {
            itemsArray = missingItems.split(',').map(i => i.trim());
        }

        // Determine who the follow-up tickets should be associated with
        let ticketTargetUserId = userId;
        if (moveIn.leaseId) {
            const lease = await tx.lease.findUnique({ where: { id: moveIn.leaseId } });
            if (lease?.tenantId) ticketTargetUserId = lease.tenantId;
        } else if (moveIn.unit?.reserved_by_id) {
            ticketTargetUserId = moveIn.unit.reserved_by_id;
        }

        // 1. Log Override
        const updatedMoveIn = await tx.moveIn.update({
            where: { id: moveInId },
            data: {
                overrideFlag: true,
                overrideReason: reason,
                overrideByUserId: userId,
                status: 'READY_FOR_MOVE_IN'
            }
        });

        // 2. Create Follow-up Tasks for missing items
        for (const item of itemsArray) {
            await tx.ticket.create({
                data: {
                    userId: ticketTargetUserId,
                    subject: `OVERRIDE FOLLOW-UP: ${item}`,
                    description: `Missing requirement at move-in. Reason: ${reason}`,
                    priority: 'High',
                    category: 'ADMIN',
                    propertyId: moveIn.unit.propertyId,
                    unitId: moveIn.unitId
                }
            });
        }

        // 3. Log to Unit History
        await tx.unitHistory.create({
            data: {
                unitId: moveIn.unitId,
                bedroomId: moveIn.bedroomId,
                userId: userId,
                action: 'MOVE_IN_OVERRIDE',
                newStatus: `Reason: ${reason} | Missing: ${itemsArray.join(', ')}`,
                timestamp: new Date()
            }
        });

        return updatedMoveIn;
    });
};

/**
 * Update Unit Preparation Stage
 */
const updateUnitPrepStage = async (unitId, { stage, userId }) => {
    return await prisma.$transaction(async (tx) => {
        const unit = await tx.unit.findUnique({ where: { id: unitId } });

        // Update stage in Unit model (readiness module)
        await tx.unit.update({
            where: { id: unitId },
            data: { 
                current_stage: stage,
                status_note: `Blocked - In Preparation (${stage})`
            }
        });

        // Create history record
        await tx.unitHistory.create({
            data: {
                unitId,
                userId,
                action: 'PREP_STAGE_CHANGED',
                newStatus: stage,
                timestamp: new Date()
            }
        });

        return { success: true, stage };
    });
};

/**
 * Sync Move-In Status (Dashboard Visibility)
 * Ensures a MoveIn record exists for any unit with a lease or reservation.
 */
const syncMoveInStatus = async (unitId, { leaseId, bedroomId, targetDate }, tx = prisma) => {
    return await tx.$transaction(async (pTx) => {
        // Find existing MoveIn
        const existing = await pTx.moveIn.findFirst({
            where: {
                unitId,
                leaseId: leaseId || null
            }
        });

        // Determine initial status based on unit classification and readiness
        const unit = await pTx.unit.findUnique({ where: { id: unitId } });
        let initialStatus = 'PENDING';
        
        if (unit.classification === 'New Construction' && !unit.unit_ready_completed) {
            initialStatus = 'BLOCKED_IN_CONSTRUCTION';
        } else if (unit.status_note?.includes('Preparation')) {
            initialStatus = 'BLOCKED_IN_PREPARATION';
        }

        if (existing) {
            // Update status if it's currently PENDING and should be BLOCKED
            if (existing.status !== initialStatus) {
                return await pTx.moveIn.update({
                    where: { id: existing.id },
                    data: { status: initialStatus }
                });
            }
            return existing;
        }

        return await pTx.moveIn.create({
            data: {
                unitId,
                leaseId,
                bedroomId,
                status: initialStatus,
                targetDate: targetDate || unit.tentative_move_in_date || new Date()
            }
        });
    });
};

/**
 * Create Tickets from Inspection
 * Parses inspection responses and creates maintenance tickets for damaged items.
 * Implements Rule 3.4 & 3.5: Gatekeeper for Required Tickets.
 */
const createTicketsFromInspection = async (inspectionId, userId) => {
    return await prisma.$transaction(async (tx) => {
        const inspection = await tx.inspection.findUnique({
            where: { id: inspectionId },
            include: { responses: true, unit: true }
        });

        const damagedResponses = inspection.responses.filter(r => 
            r.response?.toLowerCase().includes('damaged') || 
            r.response?.toLowerCase().includes('poor') ||
            r.response?.toLowerCase().includes('repair') ||
            r.status?.toLowerCase() === 'poor'
        );

        const createdTickets = [];

        for (const resp of damagedResponses) {
            const ticket = await tx.ticket.create({
                data: {
                    userId: inspection.inspectorId,
                    propertyId: inspection.unit.propertyId,
                    unitId: inspection.unitId,
                    subject: `DEFICIENCY: ${resp.question || 'Inspection Item'}`,
                    description: `Identified during inspection. Notes: ${resp.notes || 'None'}`,
                    priority: 'High',
                    category: 'MAINTENANCE',
                    status: 'Open'
                }
            });

            // Create UnitPrepTask for this ticket
            // Rule 3.4: Required = Yes Blocks
            await tx.unitPrepTask.create({
                data: {
                    unitId: inspection.unitId,
                    bedroomId: inspection.bedroomId,
                    ticketId: ticket.id,
                    title: resp.question || 'Repair Item',
                    description: resp.notes,
                    isRequired: true, 
                    stage: 'PENDING_TICKETS'
                }
            });

            createdTickets.push(ticket);
        }

        // Update unit status to reflect it's now in Prep Flow
        await tx.unit.update({
            where: { id: inspection.unitId },
            data: { 
                status_note: 'Blocked - In Preparation (Deficiencies)',
                current_stage: 'PENDING_TICKETS'
            }
        });

        return createdTickets;
    });
};

/**
 * Check and Auto-Progress Unit Prep Stage
 * Rule 3.5 & 3.6: All Required Tickets = Completed -> Auto move to Ready for Cleaning
 */
const checkAndProgressUnitPrep = async (unitId) => {
    return await prisma.$transaction(async (tx) => {
        // Find all required tasks for this unit
        const requiredTasks = await tx.unitPrepTask.findMany({
            where: { 
                unitId,
                isRequired: true
            },
            include: { ticket: true }
        });

        // Check if any required ticket is still open
        const hasOpenRequired = requiredTasks.some(task => 
            task.ticket && !['Closed', 'Completed', 'Resolved'].includes(task.ticket.status)
        );

        if (!hasOpenRequired && requiredTasks.length > 0) {
            // Rule 3.6: Auto move to Ready for Cleaning
            await tx.unit.update({
                where: { id: unitId },
                data: { 
                    current_stage: 'READY_FOR_CLEANING',
                    status_note: 'Blocked - In Preparation (Ready for Cleaning)'
                }
            });

            // Log history
            await tx.unitHistory.create({
                data: {
                    unitId,
                    action: 'AUTO_PROGRESSED',
                    newStatus: 'READY_FOR_CLEANING',
                    timestamp: new Date()
                }
            });

            return { autoProgressed: true, newStage: 'READY_FOR_CLEANING' };
        }

        return { autoProgressed: false };
    });
};

module.exports = {
    initMoveOutWorkflow,
    completeInspection,
    overrideMoveIn,
    updateUnitPrepStage,
    syncMoveInStatus,
    createTicketsFromInspection,
    checkAndProgressUnitPrep
};
