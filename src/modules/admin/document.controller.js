const prisma = require('../../config/prisma');
const path = require('path');
const documentService = require('../../services/documentService');
const fs = require('fs');
const { uploadToCloudinary } = require('../../config/cloudinary');
const axios = require('axios');


// GET /api/admin/documents
exports.getAllDocuments = async (req, res) => {
    try {
        const documents = await prisma.document.findMany({
            include: {
                user: true,
                lease: {
                    include: { tenant: true }
                },
                unit: true,
                property: true,
                invoice: true
            },
            orderBy: { createdAt: 'desc' }
        });

        const token = req.headers.authorization ? req.headers.authorization.split(' ')[1] : '';
        const formatted = documents.map(doc => ({
            ...doc,
            // Force through proxy if it's a remote URL to fix headers/auth
            fileUrl: doc.fileUrl.startsWith('http')
                ? `/api/admin/documents/${doc.id}/download?disposition=inline&token=${token}`
                : doc.fileUrl
        }));

        res.json(formatted);
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error' });
    }
};



// GET /api/admin/documents/:id/download
exports.downloadDocument = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const doc = await prisma.document.findUnique({
            where: { id }
        });

        if (!doc || !doc.fileUrl) {
            return res.status(404).json({ message: 'Document not found' });
        }

        const fileName = doc.name || `document-${id}.pdf`;

        // Handle Cloudinary URLs (Absolute) - Proxy via Axios Stream
        if (doc.fileUrl.startsWith('http')) {
            try {
                // Ensure no auth headers from our backend are leaked to Cloudinary
                const response = await axios({
                    method: 'GET',
                    url: doc.fileUrl,
                    responseType: 'stream',
                    headers: {} // Strip any ambient headers
                });

                const disposition = req.query.disposition || 'inline';

                // Set correct headers for the browser
                if (disposition === 'inline') {
                    // For inline (previews), simple 'inline' prevents forcing a download
                    res.setHeader('Content-Disposition', 'inline');
                } else {
                    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
                }

                // Determine content type more robustly
                let contentType = response.headers['content-type'];
                const ext = (doc.name || fileName || '').toLowerCase();
                const urlLower = doc.fileUrl.toLowerCase();

                if (!contentType || contentType === 'application/octet-stream' || contentType.includes('image/')) {
                    if (urlLower.endsWith('.pdf') || ext.endsWith('.pdf')) {
                        contentType = 'application/pdf';
                    } else if (urlLower.endsWith('.jpg') || urlLower.endsWith('.jpeg') || ext.endsWith('.jpg') || ext.endsWith('.jpeg')) {
                        contentType = 'image/jpeg';
                    } else if (urlLower.endsWith('.png') || ext.endsWith('.png')) {
                        contentType = 'image/png';
                    }
                }

                res.setHeader('Content-Type', contentType || 'application/pdf');

                response.data.pipe(res);
                return;
            } catch (proxyErr) {
                console.error('Cloudinary Proxy error:', proxyErr.message);
                return res.status(500).json({ message: 'Error streaming file from storage' });
            }
        }


        // Handle Local Files (Relative)
        const absolutePath = path.resolve(process.cwd(), doc.fileUrl.startsWith('/') ? doc.fileUrl.substring(1) : doc.fileUrl);

        const disposition = req.query.disposition || 'inline';
        if (disposition === 'inline') {
            res.sendFile(absolutePath, (err) => {
                if (err) {
                    console.error('File send error:', err);
                    if (!res.headersSent) res.status(404).json({ message: 'File not found' });
                }
            });
        } else {
            res.download(absolutePath, fileName, (err) => {
                if (err) {
                    console.error('File download error:', err);
                    if (!res.headersSent) res.status(404).json({ message: 'File on disk not found' });
                }
            });
        }

    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Server error during download' });
    }
};

// POST /api/admin/documents/upload
exports.uploadDocument = async (req, res) => {
    try {
        if (!req.files || Object.keys(req.files).length === 0) {
            return res.status(400).json({ message: 'No files were uploaded.' });
        }

        const file = req.files.file;
        const { type, name, expiryDate, links } = req.body;

        if (!type) {
            return res.status(400).json({ message: 'Document type is required.' });
        }

        // Upload to Cloudinary instead of local disk
        let fileUrl = '';
        if (file.tempFilePath) {
            const isPdf = file.name.toLowerCase().endsWith('.pdf');
            const result = await uploadToCloudinary(file.tempFilePath, 'admin_documents', {
                resource_type: isPdf ? 'raw' : 'auto'
            });
            fileUrl = result.secure_url;
        } else {
            // Fallback for environments where tempFilePath isn't available
            const uploadPath = path.join(process.cwd(), 'uploads', `${Date.now()}-${file.name}`);
            const dir = path.dirname(uploadPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            await file.mv(uploadPath);
            fileUrl = `/uploads/${path.basename(uploadPath)}`;
        }


        // Normalize links
        let parsedLinks = [];
        try {
            parsedLinks = links ? JSON.parse(links) : [];
            console.log('📎 Parsed links:', parsedLinks);
        } catch (e) {
            console.error('Failed to parse links:', e);
        }

        // Extract primary link for legacy fields (for Prisma include to work)
        const legacyFields = {};
        parsedLinks.forEach(link => {
            const entityType = link.entityType.toUpperCase();
            const entityId = parseInt(link.entityId);

            if (entityType === 'USER' && !legacyFields.userId) {
                legacyFields.userId = entityId;
            } else if (entityType === 'LEASE' && !legacyFields.leaseId) {
                legacyFields.leaseId = entityId;
            } else if (entityType === 'UNIT' && !legacyFields.unitId) {
                legacyFields.unitId = entityId;
            } else if (entityType === 'PROPERTY' && !legacyFields.propertyId) {
                legacyFields.propertyId = entityId;
            } else if (entityType === 'INVOICE' && !legacyFields.invoiceId) {
                legacyFields.invoiceId = entityId;
            }
        });

        console.log('🔗 Legacy fields extracted:', legacyFields);

        // Use service to create record and links
        const doc = await documentService.linkDocument({
            name: name || file.name,
            type,
            fileUrl: fileUrl,

            links: parsedLinks,
            expiryDate,
            ...legacyFields
        });

        console.log('✅ Document created:', { id: doc.id, name: doc.name, leaseId: doc.leaseId, userId: doc.userId });

        res.status(201).json(doc);
    } catch (e) {
        console.error('Upload Error:', e);
        res.status(500).json({ message: 'Failed to upload document' });
    }
};

// DELETE /api/admin/documents/:id
exports.deleteDocument = async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const doc = await prisma.document.findUnique({ where: { id } });

        // Delete actual file if local
        if (doc && doc.fileUrl && !doc.fileUrl.startsWith('http')) {
            const filePath = path.join(process.cwd(), doc.fileUrl);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }

        await documentService.deleteDocument(id);
        res.json({ message: 'Document deleted successfully' });
    } catch (e) {
        console.error(e);
        res.status(500).json({ message: 'Failed to delete document' });
    }
};
