const prisma = require("../../config/prisma");
const smsService = require("../../services/sms.service");

/**
 * Get all SMS templates
 */
exports.getTemplates = async (req, res) => {
    try {
        const templates = await prisma.sMSTemplate.findMany({
            orderBy: { createdAt: 'desc' }
        });
        res.json(templates);
    } catch (error) {
        console.error('Error fetching SMS templates:', error);
        res.status(500).json({ error: 'Failed to fetch templates' });
    }
};

/**
 * Create a new SMS template
 */
exports.createTemplate = async (req, res) => {
    try {
        const { name, content, category } = req.body;
        if (!name || !content) {
            return res.status(400).json({ error: 'Name and content are required' });
        }

        const template = await prisma.sMSTemplate.create({
            data: { name, content, category }
        });
        res.status(201).json(template);
    } catch (error) {
        console.error('Error creating SMS template:', error);
        res.status(500).json({ error: 'Failed to create template' });
    }
};

/**
 * Update an SMS template
 */
exports.updateTemplate = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, content, category } = req.body;

        const template = await prisma.sMSTemplate.update({
            where: { id: parseInt(id) },
            data: { name, content, category }
        });
        res.json(template);
    } catch (error) {
        console.error('Error updating SMS template:', error);
        res.status(500).json({ error: 'Failed to update template' });
    }
};

/**
 * Delete an SMS template
 */
exports.deleteTemplate = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.sMSTemplate.delete({
            where: { id: parseInt(id) }
        });
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting SMS template:', error);
        res.status(500).json({ error: 'Failed to delete template' });
    }
};

/**
 * Create and start an SMS Campaign
 */
exports.createCampaign = async (req, res) => {
    try {
        const { name, templateId, customContent, buildingId, recipientType } = req.body;
        const senderId = req.user.id;

        if (!name || (!templateId && !customContent)) {
            return res.status(400).json({ error: 'Name and a message (template or custom) are required' });
        }

        let messageBody = customContent;

        if (templateId) {
            const template = await prisma.sMSTemplate.findUnique({
                where: { id: parseInt(templateId) }
            });

            if (!template) {
                return res.status(404).json({ error: 'Template not found' });
            }
            messageBody = template.content;
        }

        if (!messageBody) {
            return res.status(400).json({ error: 'Message content cannot be empty' });
        }

        // 1. Build recipient list based on filters
        let whereClause = {
            isActive: true
        };

        if (recipientType === 'COWORKERS') {
            whereClause.role = 'COWORKER';
        } else if (recipientType === 'ALL') {
             // Handle ALL: (Tenant in Building) OR (Coworker)
             // For simple prisma query, we can do multiple fetches or a complex OR
             whereClause.role = { in: ['TENANT', 'COWORKER'] };
        } else {
            // Default: TENANTS
            whereClause.role = 'TENANT';
            if (buildingId) {
                whereClause.buildingId = parseInt(buildingId);
            }
        }

        const recipients = await prisma.user.findMany({
            where: whereClause,
            include: {
                unit: true,
                building: true
            }
        });

        if (recipients.length === 0) {
            return res.status(400).json({ error: 'No recipients found for the selected filters' });
        }

        // 2. Create Campaign Record
        const campaign = await prisma.sMSCampaign.create({
            data: {
                name,
                senderId,
                buildingId: buildingId ? parseInt(buildingId) : null,
                totalRecipients: recipients.length,
                status: 'PENDING'
            }
        });

        // 3. Start processing in background (Async)
        // We don't 'await' this so the response is immediate
        smsService.processCampaign(recipients, messageBody, campaign.id).catch(err => {
            console.error(`Fatal error in campaign ${campaign.id}:`, err);
        });

        res.status(201).json({ 
            message: 'Campaign started successfully', 
            campaignId: campaign.id,
            totalRecipients: recipients.length 
        });

    } catch (error) {
        console.error('Error creating SMS campaign:', error);
        res.status(500).json({ error: 'Failed to create campaign' });
    }
};

/**
 * Get all SMS campaigns
 */
exports.getCampaigns = async (req, res) => {
    try {
        const campaigns = await prisma.sMSCampaign.findMany({
            orderBy: { createdAt: 'desc' }
        });
        res.json(campaigns);
    } catch (error) {
        console.error('Error fetching SMS campaigns:', error);
        res.status(500).json({ error: 'Failed to fetch campaigns' });
    }
};

/**
 * Get unread messages count for Admin (Synced with Inbox visibility)
 */
exports.getUnreadStats = async (req, res) => {
    try {
        const count = await prisma.message.count({
            where: {
                direction: 'INBOUND',
                isReadByAdmin: false,
                sender: {
                    OR: [
                        { role: 'OWNER' },
                        { 
                            AND: [
                                { role: 'TENANT' },
                                { type: { not: 'RESIDENT' } },
                                { leases: { some: { status: 'Active' } } }
                            ]
                        },
                        {
                            AND: [
                                { type: 'RESIDENT' },
                                { residentLease: { status: 'Active' } }
                            ]
                        }
                    ]
                }
            }
        });
        res.json({ count });
    } catch (error) {
        console.error('Error fetching unread stats:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
};
/**
 * Delete an SMS campaign
 */
exports.deleteCampaign = async (req, res) => {
    try {
        const { id } = req.params;
        await prisma.sMSCampaign.delete({
            where: { id: parseInt(id) }
        });
        res.json({ success: true, message: 'Campaign deleted successfully' });
    } catch (error) {
        console.error('Error deleting SMS campaign:', error);
        res.status(500).json({ error: 'Failed to delete campaign' });
    }
};
