const prisma = require('../../config/prisma');
const workflowService = require('../../services/workflow.service');
const { cloudinary } = require('../../config/cloudinary');
const { generateInspectionPDF } = require('../../utils/pdf.utils');

// Upload base64 image string directly to Cloudinary
const uploadBase64ToCloudinary = (base64String, folder = 'inspection_photos') => {
    return new Promise((resolve, reject) => {
        cloudinary.uploader.upload(
            base64String,
            { folder, resource_type: 'image' },
            (error, result) => {
                if (error) reject(error);
                else resolve(result.secure_url);
            }
        );
    });
};

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
        const { templateId, unitId, leaseId, bedroomId, date } = req.body;
        const inspectorId = req.user?.id || 1; // Fallback to 1 if user context missing for testing

        // Check if template exists
        if (!templateId || isNaN(parseInt(templateId))) {
            return res.status(400).json({ success: false, message: 'Please select a valid inspection template.' });
        }

        const template = await prisma.inspectionTemplate.findUnique({ where: { id: parseInt(templateId) } });
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

        const inspection = await prisma.inspection.findUnique({
            where: { id: parseInt(id) },
            include: { template: true }
        });

        if (!inspection) return res.status(404).json({ success: false, message: 'Inspection not found' });

        // Validate completion rules
        // 1. Tenant signature is mandatory
        if (!signature && !noDeficiencyConfirmed) {
            return res.status(400).json({ success: false, message: 'Tenant signature or No Deficiency confirmation is required.' });
        }

        // 2. All line items must be reviewed (checked on frontend, but we store them here)

        // Use transaction via service for workflow transitions
        const result = await workflowService.completeInspection(parseInt(id), {
            signature,
            noDeficiencyConfirmed
        });

        // Save or update responses (with Cloudinary photo upload)
        if (responses && responses.length > 0) {
            for (const resp of responses) {
                // If photo is a base64 string, upload to Cloudinary first
                let photoUrl = resp.photo || null;
                if (photoUrl && photoUrl.startsWith('data:image')) {
                    try {
                        photoUrl = await uploadBase64ToCloudinary(photoUrl, 'inspection_photos');
                    } catch (uploadErr) {
                        console.error('Cloudinary upload failed for response photo:', uploadErr.message);
                        photoUrl = null; // Don't block submission if upload fails
                    }
                }

                // Create or Update based on whether ID exists
                if (resp.id) {
                    await prisma.inspectionItemResponse.update({
                        where: { id: resp.id },
                        data: {
                            response: resp.response,
                            notes: resp.notes,
                            annotation: resp.annotation,
                            photoUrl: photoUrl
                        }
                    });
                } else {
                    await prisma.inspectionItemResponse.create({
                        data: {
                            inspectionId: parseInt(id),
                            question: resp.question || 'Unknown',
                            response: resp.response,
                            notes: resp.notes,
                            annotation: resp.annotation,
                            photoUrl: photoUrl
                        }
                    });
                }
            }
        }

        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const getAllInspections = async (req, res) => {
    try {
        const inspections = await prisma.inspection.findMany({
            include: {
                template: true,
                unit: true,
                lease: { include: { tenant: true } },
                inspector: { select: { id: true, name: true } },
                tickets: true
            },
            orderBy: { createdAt: 'desc' }
        });
        res.json({ success: true, data: inspections });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const updateInspection = async (req, res) => {
    try {
        const { id } = req.params;
        const { responses, signature, noDeficiencyConfirmed } = req.body;
        const userId = req.user.id;

        const existing = await prisma.inspection.findUnique({
            where: { id: parseInt(id) },
            include: { responses: true }
        });

        if (!existing) return res.status(404).json({ success: false, message: 'Inspection not found' });

        const updates = {};
        const auditLogs = [];

        // Track changes for Audit Log
        if (signature && signature !== existing.tenantSignature) {
            auditLogs.push({
                userId,
                action: 'UPDATE_SIGNATURE',
                entity: 'Inspection',
                entityId: parseInt(id),
                details: `Signature changed from ${existing.tenantSignature ? 'Existing' : 'None'} to New Signature`
            });
            updates.tenantSignature = signature;
        }

        await prisma.$transaction(async (tx) => {
            // Update main inspection record
            if (Object.keys(updates).length > 0) {
                await tx.inspection.update({
                    where: { id: parseInt(id) },
                    data: updates
                });
            }

            // Update responses and log changes
            if (responses && responses.length > 0) {
                for (const resp of responses) {
                    const oldResp = existing.responses.find(r => r.id === resp.id);
                    if (oldResp) {
                        const changes = [];
                        if (resp.response !== oldResp.response) changes.push(`Response: ${oldResp.response} -> ${resp.response}`);
                        if (resp.notes !== oldResp.notes) changes.push(`Notes changed`);
                        if (resp.annotation !== oldResp.annotation) changes.push(`Annotation changed`);

                        if (changes.length > 0) {
                            auditLogs.push({
                                userId,
                                action: 'UPDATE_RESPONSE',
                                entity: 'InspectionItemResponse',
                                entityId: resp.id,
                                details: changes.join(', ')
                            });

                            await tx.inspectionItemResponse.update({
                                where: { id: resp.id },
                                data: {
                                    response: resp.response,
                                    notes: resp.notes,
                                    annotation: resp.annotation
                                }
                            });
                        }
                    }
                }
            }

            // Create Audit Logs
            if (auditLogs.length > 0) {
                await tx.auditLog.createMany({
                    data: auditLogs
                });
            }
        });

        res.json({ success: true, message: 'Inspection updated and changes logged.' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

const downloadInspectionPDF = async (req, res) => {
    try {
        const { id } = req.params;
        const inspection = await prisma.inspection.findUnique({
            where: { id: parseInt(id) },
            include: {
                template: true,
                responses: true,
                unit: { include: { property: true } },
                lease: { include: { tenant: true } },
                inspector: { select: { id: true, name: true } },
                tickets: true
            }
        });

        if (!inspection) {
            return res.status(404).json({ success: false, message: 'Inspection not found' });
        }

        await generateInspectionPDF(inspection, res);
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
                inspector: { select: { id: true, name: true, email: true } },
                tickets: true
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
        const { questionId, questionText, notes, priority, category, type } = req.body;

        const inspection = await prisma.inspection.findUnique({
            where: { id: parseInt(id) },
            include: { unit: true, template: true }
        });

        if (!inspection) return res.status(404).json({ success: false, message: 'Inspection not found' });

        let ticket;
        try {
            // 1. Create Maintenance Ticket
            ticket = await prisma.ticket.create({
                data: {
                    userId: inspection.inspectorId,
                    propertyId: inspection.unit?.propertyId,
                    unitId: inspection.unitId,
                    subject: `DEFICIENCY: ${questionText}`,
                    description: `Identified during inspection. Notes: ${notes}`,
                    priority: priority || 'High',
                    category: category || 'MAINTENANCE',
                    type: type || 'REPAIR',
                    status: 'Open',
                    source: inspection.template?.type === 'MOVE_OUT' ? 'MOVE_OUT' : 'MOVE_IN',
                    isRequired: true,
                    inspectionId: parseInt(id)
                }
            });
        } catch (ticketErr) {
            console.error('TICKET_CREATE_ERROR:', ticketErr);
            throw new Error(`Ticket Creation Failed: ${ticketErr.message}`);
        }

        try {
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
        } catch (prepErr) {
            console.error('PREP_TASK_CREATE_ERROR:', prepErr);
            // Non-blocking for now
        }

        try {
            // 3. Update Unit to Blocked status (Triggered by any inspection deficiency)
            await prisma.unit.update({
                where: { id: inspection.unitId },
                data: {
                    status_note: `Blocked - Maintenance Required (${inspection.template?.type || 'INSPECTION'})`,
                    current_stage: 'PENDING_TICKETS'
                }
            });
        } catch (unitErr) {
            console.error('UNIT_UPDATE_ERROR:', unitErr);
        }

        res.json({ success: true, data: ticket });
    } catch (error) {
        console.error('OVERALL_CREATE_TICKET_ERROR:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const deleteTicket = async (req, res) => {
    try {
        const { id, ticketId } = req.params;

        await prisma.$transaction(async (tx) => {
            // 1. Delete associated UnitPrepTask
            await tx.unitPrepTask.deleteMany({
                where: { ticketId: parseInt(ticketId) }
            });

            // 2. Delete the Ticket
            const ticket = await tx.ticket.delete({
                where: { id: parseInt(ticketId) }
            });

            // 3. Check if unit should be unblocked (any remaining required tickets?)
            const remainingRequired = await tx.ticket.count({
                where: {
                    unitId: ticket.unitId,
                    status: 'Open',
                    isRequired: true
                }
            });

            if (remainingRequired === 0) {
                await tx.unit.update({
                    where: { id: ticket.unitId },
                    data: {
                        status_note: 'Unblocked - Maintenance Complete',
                        current_stage: 'READY_FOR_CLEANING'
                    }
                });
            }
        });

        res.json({ success: true, message: 'Ticket and associated prep tasks removed.' });
    } catch (error) {
        console.error('DELETE_TICKET_ERROR:', error);
        res.status(500).json({ success: false, message: error.message });
    }
};

const deleteInspection = async (req, res) => {
    try {
        const { id } = req.params;

        await prisma.$transaction(async (tx) => {
            // Delete responses
            await tx.inspectionItemResponse.deleteMany({ where: { inspectionId: parseInt(id) } });
            // Delete inspection
            await tx.inspection.delete({ where: { id: parseInt(id) } });
        });

        res.json({ success: true, message: 'Inspection deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    deleteInspection,
    createTemplate,
    getTemplates,
    createInspection,
    submitInspection,
    getInspectionDetails,
    createTicket,
    deleteTicket,
    updateInspection,
    getAllInspections,
    downloadInspectionPDF,
    deleteTemplate,
    duplicateTemplate,
    updateTemplate,
    getResponseSeries,
    createResponseSeries,
    updateResponseSeries,
    deleteResponseSeries
};

async function updateTemplate(req, res) {
    try {
        const { id } = req.params;
        const { name, type, structure } = req.body;
        const updated = await prisma.inspectionTemplate.update({
            where: { id: parseInt(id) },
            data: { name, type, structure }
        });
        res.json({ success: true, data: updated });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}

async function deleteTemplate(req, res) {
    try {
        const { id } = req.params;
        await prisma.inspectionTemplate.delete({ where: { id: parseInt(id) } });
        res.json({ success: true, message: 'Template deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}

async function duplicateTemplate(req, res) {
    try {
        const { id } = req.params;
        const original = await prisma.inspectionTemplate.findUnique({ where: { id: parseInt(id) } });
        if (!original) return res.status(404).json({ success: false, message: 'Not found' });

        const clone = await prisma.inspectionTemplate.create({
            data: {
                name: `${original.name} (Copy)`,
                type: original.type,
                description: original.description,
                structure: original.structure
            }
        });
        res.json({ success: true, data: clone });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}

async function getResponseSeries(req, res) {
    try {
        const series = await prisma.templateSeries.findMany({
            include: { responses: { orderBy: { order: 'asc' } } }
        });
        res.json({ success: true, data: series });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}

async function createResponseSeries(req, res) {
    try {
        const { name, description, responses } = req.body;
        const series = await prisma.templateSeries.create({
            data: {
                name,
                description,
                responses: {
                    create: responses.map((r, idx) => ({
                        label: r.label,
                        color: r.color,
                        order: idx
                    }))
                }
            },
            include: { responses: true }
        });
        res.status(201).json({ success: true, data: series });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}

async function updateResponseSeries(req, res) {
    try {
        const { id } = req.params;
        const { name, description, responses } = req.body;

        // Transaction to update series and sync responses
        const updated = await prisma.$transaction(async (tx) => {
            await tx.templateResponse.deleteMany({ where: { seriesId: parseInt(id) } });
            return await tx.templateSeries.update({
                where: { id: parseInt(id) },
                data: {
                    name,
                    description,
                    responses: {
                        create: responses.map((r, idx) => ({
                            label: r.label,
                            color: r.color,
                            order: idx
                        }))
                    }
                },
                include: { responses: true }
            });
        });
        res.json({ success: true, data: updated });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}

async function deleteResponseSeries(req, res) {
    try {
        const { id } = req.params;
        await prisma.templateSeries.delete({ where: { id: parseInt(id) } });
        res.json({ success: true, message: 'Series deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
}
