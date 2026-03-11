const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Twilio Webhook Handler for Incoming SMS
 * This endpoint receives incoming SMS messages from Twilio and creates them in the database
 */
exports.handleIncomingSMS = async (req, res) => {
    try {
        const { From, To, Body, MessageSid } = req.body;

        console.log('📱 Incoming SMS from Twilio:', { From, To, Body, MessageSid });

        if (!From) {
            console.error('❌ Missing From number in Twilio webhook');
            return res.status(400).send('Missing From number');
        }

        // Clean the incoming phone number (remove +, and get last 10 digits for matching)
        const cleanFrom = From.replace(/\D/g, '').slice(-10);

        // Find the user by phone number (sender)
        // We use 'contains' with the last 10 digits to be robust against different DB formats (+1..., ..., ...)
        const sender = await prisma.user.findFirst({
            where: {
                phone: {
                    contains: cleanFrom
                }
            }
        });

        if (!sender) {
            console.warn(`⚠️ No user found with phone number matching: ${cleanFrom} (Original: ${From})`);
            // Optional: You could log this to a general 'Unknown' inbox if you want
            res.set('Content-Type', 'text/xml');
            return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Message>Sorry, we couldn't identify your account. Please contact your property manager.</Message>
</Response>`);
        }

        // Find which admin to assign this to. 
        // Strategy: Find the admin who last sent a message to this user.
        // Fallback: Use the first admin found in the system.
        const lastMessageToSender = await prisma.message.findFirst({
            where: {
                receiverId: sender.id,
                sender: { role: 'ADMIN' }
            },
            orderBy: { createdAt: 'desc' },
            select: { senderId: true }
        });

        let assignedAdminId;
        if (lastMessageToSender) {
            assignedAdminId = lastMessageToSender.senderId;
        } else {
            const firstAdmin = await prisma.user.findFirst({
                where: { role: 'ADMIN' }
            });
            assignedAdminId = firstAdmin ? firstAdmin.id : null;
        }

        if (!assignedAdminId) {
            console.error('❌ No admin user found to receive incoming SMS');
            res.set('Content-Type', 'text/xml');
            return res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Message>System error. Please try again later.</Message>
</Response>`);
        }

        // Create message in database
        const message = await prisma.message.create({
            data: {
                content: Body,
                senderId: sender.id,
                receiverId: assignedAdminId,
                isRead: false,
                smsSid: MessageSid,
                smsStatus: 'received',
                sentVia: 'sms' // Incoming is always via SMS
            }
        });

        console.log(`✅ SMS from ${sender.name} saved to database (ID: ${message.id}, Assigned to Admin: ${assignedAdminId})`);

        // Send TwiML response (optional auto-reply)
        res.set('Content-Type', 'text/xml');
        // If it's a resident, maybe different auto-reply? 
        // For now, keep it simple but friendly.
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
</Response>`); // Empty response means no auto-reply (cleaner for users)

    } catch (error) {
        console.error('❌ Error handling incoming SMS:', error);
        res.set('Content-Type', 'text/xml');
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Message>Error processing your message. Please try again.</Message>
</Response>`);
    }
};


/**
 * Twilio Status Callback Handler
 * Updates SMS delivery status in the database
 */
exports.handleSMSStatusCallback = async (req, res) => {
    try {
        const { MessageSid, MessageStatus } = req.body;

        console.log('📊 SMS Status Update:', { MessageSid, MessageStatus });

        // Update message status in database
        const updated = await prisma.message.updateMany({
            where: { smsSid: MessageSid },
            data: { smsStatus: MessageStatus }
        });

        console.log(`✅ Updated ${updated.count} message(s) with status: ${MessageStatus}`);

        res.sendStatus(200);
    } catch (error) {
        console.error('❌ Error handling SMS status callback:', error);
        res.sendStatus(500);
    }
};