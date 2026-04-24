const prisma = require('../../config/prisma');
const workflowService = require('../../services/workflow.service');

/**
 * Inspection Controller
 * Handles templates and inspection records
 */

const createTemplate = async (req, res) => {
    try {
        const { name, type, structure } = req.body;
        const template = await prisma.inspectionTemplate.create({
            data: { name, type, structure }
        });
        res.status(201).json({ success: true, data: template });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getTemplates = async (req, res) => {
    try {
        const { type } = req.query;
        const templates = await prisma.inspectionTemplate.findMany({
            where: type ? { type } : {}
        });
        res.json({ success: true, data: templates });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const createInspection = async (req, res) => {
    try {
        const { templateId, unitId, leaseId, bedroomId } = req.body;
        const inspectorId = req.user.id;

        // Check if template exists
        const template = await prisma.inspectionTemplate.findUnique({ where: { id: templateId } });
        if (!template) return res.status(404).json({ success: false, message: 'Template not found' });

        // Lock template
        await prisma.inspectionTemplate.update({
            where: { id: templateId },
            data: { isLocked: true }
        });

        const inspection = await prisma.inspection.create({
            data: {
                templateId,
                unitId,
                leaseId,
                bedroomId,
                inspectorId,
                status: 'DRAFT'
            }
        });

        res.status(201).json({ success: true, data: inspection });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const submitInspection = async (req, res) => {
    try {
        const { id } = req.params;
        const { signature, noDeficiencyConfirmed, responses } = req.body;

        // Use transaction via service
        const result = await workflowService.completeInspection(parseInt(id), {
            signature,
            noDeficiencyConfirmed
        });

        // Save responses
        if (responses && responses.length > 0) {
            for (const resp of responses) {
                const itemResp = await prisma.inspectionItemResponse.create({
                    data: {
                        inspectionId: parseInt(id),
                        question: resp.question,
                        response: resp.response,
                        notes: resp.notes
                    }
                });

                // Handle media if present
                if (resp.media && resp.media.length > 0) {
                    await prisma.inspectionMedia.createMany({
                        data: resp.media.map(m => ({
                            responseId: itemResp.id,
                            url: m.url,
                            annotations: m.annotations
                        }))
                    });
                }

                // If item has a ticket, it should be created via separate Ticket controller or logic
            }
        }

        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getInspectionDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const inspection = await prisma.inspection.findUnique({
            where: { id: parseInt(id) },
            include: {
                template: true,
                responses: {
                    include: { media: true }
                },
                unit: true,
                lease: { include: { tenant: true } },
                inspector: { select: { id: true, name: true, email: true } }
            }
        });

        if (!inspection) return res.status(404).json({ success: false, message: 'Inspection not found' });

        res.json({ success: true, data: inspection });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const createTicket = async (req, res) => {
    try {
        const { id } = req.params;
        const { questionId, questionText, notes } = req.body;

        const inspection = await prisma.inspection.findUnique({
            where: { id: parseInt(id) },
            include: { unit: true }
        });

        if (!inspection) return res.status(404).json({ success: false, message: 'Inspection not found' });

        // 1. Create Maintenance Ticket
        const ticket = await prisma.ticket.create({
            data: {
                userId: inspection.inspectorId,
                propertyId: inspection.unit.propertyId,
                unitId: inspection.unitId,
                subject: `DEFICIENCY: ${questionText}`,
                description: `Identified during inspection. Notes: ${notes}`,
                priority: 'High',
                category: 'MAINTENANCE',
                status: 'Open'
            }
        });

        // 2. Create UnitPrepTask (The Gatekeeper)
        await prisma.unitPrepTask.create({
            data: {
                unitId: inspection.unitId,
                bedroomId: inspection.bedroomId,
                ticketId: ticket.id,
                title: questionText,
                description: notes,
                isRequired: true,
                stage: 'PENDING_TICKETS'
            }
        });

        // 3. Update Unit to Blocked status
        await prisma.unit.update({
            where: { id: inspection.unitId },
            data: { 
                status_note: 'Blocked - In Preparation (Deficiencies)',
                current_stage: 'PENDING_TICKETS'
            }
        });

        res.json({ success: true, data: ticket });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    createTemplate,
    getTemplates,
    createInspection,
    submitInspection,
    getInspectionDetails,
    createTicket
};
