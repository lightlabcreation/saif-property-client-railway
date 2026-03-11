const PDFDocument = require('pdfkit');

/**
 * Generates an Invoice PDF
 * @param {Object} invoice - Invoice object from DB
 * @param {Object} res - Express response object
 * @param {Object} settings - System settings for branding
 */
/**
 * Generates an Invoice PDF
 * @param {Object} invoice - Invoice object from DB (enriched with relations)
 * @param {Object} res - Express response object
 * @param {Object} settings - System settings for branding
 */
const generateInvoicePDF = (invoice, res, settings = {}) => {
    const doc = new PDFDocument({
        margin: 50,
        size: 'A4',
        bufferPages: true
    });

    // Set Response Headers
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=invoice-${invoice.invoiceNo}.pdf`);

    doc.pipe(res);

    // --- HELPER: Colors & Styles ---
    const colors = {
        primary: '#4f46e5', // Indigo 600
        secondary: '#64748b', // Slate 500
        text: '#1e293b', // Slate 800
        lightText: '#94a3b8', // Slate 400
        border: '#e2e8f0', // Slate 200
        accent: '#f8fafc' // Slate 50
    };

    // --- HEADER SECTION ---
    const logoPath = 'c:\\Users\\Admin\\Desktop\\property_new_clone\\frontned_property\\public\\assets\\logo.png';
    try {
        doc.image(logoPath, 50, 45, { width: 140 });
        // Precise masking of the sub-text area under the "MASTEKO" name
        doc.save(); // Save state
        doc.rect(50, 70, 150, 40).fill('#ffffff');
        doc.restore(); // Restore state
    } catch (e) {
        doc.fontSize(24).fillColor(colors.primary).font('Helvetica-Bold').text('MASTEKO', 50, 50);
    }

    // Header info removed at user request (Company details and taglines)

    doc.moveTo(50, 115).lineTo(550, 115).strokeColor(colors.border).lineWidth(1).stroke();

    // --- INVOICE TITLE & INFO ---
    doc.fillColor(colors.text).font('Helvetica-Bold').fontSize(22).text('INVOICE', 50, 140);

    // Status Badge removed at user request (e.g. "SENT")

    // Invoice Meta (right aligned)
    let metaY = 175;
    const drawMeta = (label, value) => {
        doc.fillColor(colors.secondary).font('Helvetica-Bold').fontSize(10).text(label, 350, metaY);
        doc.fillColor(colors.text).font('Helvetica').fontSize(10).text(value, 460, metaY, { align: 'right', width: 90 });
        metaY += 18;
    };

    drawMeta('Invoice Number:', invoice.invoiceNo);
    drawMeta('Invoice Date:', new Date(invoice.createdAt || Date.now()).toLocaleDateString());
    drawMeta('Billing Period:', invoice.month || 'N/A');
    drawMeta('Due Date:', invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : 'Upon Receipt');

    // --- BILLING DETAILS SECTION ---
    doc.moveTo(50, 260).lineTo(550, 260).strokeColor(colors.border).lineWidth(0.5).stroke();

    // Billed To
    doc.fillColor(colors.primary).font('Helvetica-Bold').fontSize(12).text('BILLED TO', 50, 280);
    doc.fillColor(colors.text).font('Helvetica-Bold').fontSize(11).text(invoice.tenant?.name || 'Valued Tenant', 50, 300);
    doc.fillColor(colors.secondary).font('Helvetica').fontSize(9).text(invoice.tenant?.email || '', 50, 314);
    doc.text(invoice.tenant?.phone || '', 50, 326);

    // Property Details
    doc.fillColor(colors.primary).font('Helvetica-Bold').fontSize(12).text('PROPERTY DETAILS', 300, 280);
    doc.fillColor(colors.text).font('Helvetica-Bold').fontSize(10).text(invoice.unit?.property?.name || 'N/A', 300, 300);
    doc.font('Helvetica').fontSize(9).fillColor(colors.secondary);
    doc.text(`Unit: ${invoice.unit?.name || 'N/A'}`, 300, 314);

    // Bedroom details if applicable
    if (invoice.lease?.bedroom) {
        doc.text(`Bedroom: ${invoice.lease.bedroom.bedroomNumber}`, 300, 326);
    } else if (invoice.leaseType === 'BEDROOM_WISE' || invoice.lease?.leaseType === 'BEDROOM_WISE') {
        doc.text('Bedroom Wise Rental', 300, 326);
    } else {
        doc.text('Full Unit Lease', 300, 326);
    }

    // --- TABLE SECTION ---
    const tableTop = 380;
    doc.fillColor(colors.accent).rect(50, tableTop, 500, 25).fill();

    doc.fillColor(colors.secondary).font('Helvetica-Bold').fontSize(9);
    doc.text('DESCRIPTION', 60, tableTop + 8);
    doc.text('CATEGORY', 250, tableTop + 8);
    doc.text('AMOUNT', 450, tableTop + 8, { align: 'right', width: 90 });

    let currentY = tableTop + 35;
    const drawRow = (desc, cat, amt) => {
        doc.fillColor(colors.text).font('Helvetica').fontSize(10).text(desc, 60, currentY, { width: 180 });
        doc.fillColor(colors.secondary).text(cat, 250, currentY);
        doc.fillColor(colors.text).font('Helvetica-Bold').text(`$${parseFloat(amt).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, 450, currentY, { align: 'right', width: 90 });
        currentY += 25;
        doc.moveTo(50, currentY - 5).lineTo(550, currentY - 5).strokeColor(colors.accent).lineWidth(0.5).stroke();
    };

    // Rent Row
    if (parseFloat(invoice.rent) > 0) {
        drawRow('Monthly Rent Coverage', invoice.category === 'DEPOSIT' ? 'Security Deposit' : 'Rental Income', invoice.rent);
    }

    // Service Fees Row
    if (parseFloat(invoice.serviceFees) > 0) {
        drawRow(invoice.description || 'Service/Utility Fees', 'Service Charges', invoice.serviceFees);
    }

    // Other items? (Invoice amount fallback)
    if (currentY === tableTop + 35) {
        drawRow(invoice.description || 'Property Management Charges', invoice.category, invoice.amount);
    }

    // --- TOTALS SECTION ---
    currentY += 20;
    doc.fillColor(colors.accent).rect(340, currentY, 210, 80).fill();

    let totalY = currentY + 15;
    const drawTotalRow = (label, value, isBold = false) => {
        doc.fillColor(colors.secondary).font(isBold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).text(label, 350, totalY);
        doc.fillColor(isBold ? colors.primary : colors.text).font('Helvetica-Bold').fontSize(10).text(value, 450, totalY, { align: 'right', width: 90 });
        totalY += 20;
    };

    drawTotalRow('Subtotal:', `$${parseFloat(invoice.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
    drawTotalRow('Paid Amount:', `$${parseFloat(invoice.paidAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`);
    drawTotalRow('TOTAL DUE:', `$${parseFloat(invoice.balanceDue || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`, true);

    // --- FOOTER SECTION ---
    // Removed at user request

    doc.end();
};

/**
 * Generates a Payment Receipt PDF
 * @param {Object} payment - Invoice/Payment object from DB
 * @param {Object} res - Express response object
 */
const generateReceiptPDF = (payment, res) => {
    const doc = new PDFDocument({ margin: 50 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=receipt-${payment.invoiceNo}.pdf`);

    doc.pipe(res);

    doc.fontSize(25).text('PAYMENT RECEIPT', { align: 'center' });
    doc.moveDown();

    doc.fontSize(12).text(`Receipt Number: RCP-${payment.id}`);
    doc.text(`Date of Payment: ${payment.paidAt ? new Date(payment.paidAt).toLocaleDateString() : 'N/A'}`);
    doc.text(`Invoice Reference: ${payment.invoiceNo}`);
    doc.moveDown();

    doc.fontSize(14).text('Payment Details:', { underline: true });
    doc.fontSize(12).text(`Tenant: ${payment.tenant.name}`);
    doc.text(`Unit: ${payment.unit.name}`);
    doc.text(`Amount Paid: $${parseFloat(payment.amount).toFixed(2)}`);
    doc.text(`Payment Method: ${payment.paymentMethod || 'Online'}`);
    doc.moveDown();

    doc.text('Status: PAID', { align: 'center', color: 'green' });

    doc.end();
};

/**
 * Generates a Lease Agreement PDF (Stub/Template)
 * @param {Object} lease - Lease object from DB
 * @param {Object} res - Express response object
 */
const generateLeasePDF = (lease, res) => {
    const doc = new PDFDocument({ margin: 50 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=lease-${lease.id}.pdf`);

    doc.pipe(res);

    doc.fontSize(20).text('RESIDENTIAL LEASE AGREEMENT', { align: 'center' });
    doc.moveDown();

    doc.fontSize(12).text(`This agreement is made on ${new Date(lease.createdAt).toLocaleDateString()}.`);
    doc.moveDown();

    doc.text(`Landlord: Masteko Represented Owners`);
    doc.text(`Tenant: ${lease.tenant.name}`);
    doc.moveDown();

    doc.fontSize(14).text('1. PREMISES', { underline: true });
    doc.fontSize(12).text(`The landlord leases to the tenant the premises located at: Unit ${lease.unit.name}, ${lease.unit.property.name}.`);
    doc.moveDown();

    doc.fontSize(14).text('2. TERM', { underline: true });
    doc.fontSize(12).text(`The lease term shall begin on ${new Date(lease.startDate).toLocaleDateString()} and end on ${new Date(lease.endDate).toLocaleDateString()}.`);
    doc.moveDown();

    doc.fontSize(14).text('3. RENT', { underline: true });
    doc.fontSize(12).text(`The monthly rent shall be $${parseFloat(lease.monthlyRent).toFixed(2)} payable on the 1st of each month.`);
    doc.moveDown();

    doc.fontSize(14).text('4. SECURITY DEPOSIT', { underline: true });
    doc.fontSize(12).text(`The tenant has paid a security deposit of $${parseFloat(lease.securityDeposit).toFixed(2)}.`);
    doc.moveDown();

    doc.text('This is a formal lease agreement generated by Masteko.', 50, 700, { align: 'center' });

    doc.end();
};

/**
 * Generates a Generic Report PDF
 * @param {string} reportId - ID of report (placeholder logic)
 * @param {Object} res - Express response object
 */
const generateReportPDF = (reportId, res) => {
    const doc = new PDFDocument({ margin: 50 });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=report-${reportId}.pdf`);

    doc.pipe(res);

    doc.fontSize(25).text('DATA EXPORT REPORT', { align: 'center' });
    doc.moveDown();

    doc.fontSize(12).text(`Report Type: ${reportId}`);
    doc.text(`Generated On: ${new Date().toLocaleString()}`);
    doc.moveDown();

    doc.text('This PDF contains a summary of the requested data export from PropManage SaaS.');
    doc.moveDown();

    doc.text('Summary Data Placeholder:', { underline: true });
    doc.fontSize(10).text('Monthly Revenue: $120,500.00');
    doc.text('Occupancy Rate: 94%');
    doc.text('Active Leases: 42');
    doc.moveDown();

    doc.end();
};

module.exports = {
    generateInvoicePDF,
    generateReceiptPDF,
    generateLeasePDF,
    generateReportPDF
};
