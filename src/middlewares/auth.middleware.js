const jwt = require('jsonwebtoken');

exports.authenticate = (req, res, next) => {
    let token = '';
    const authHeader = req.headers.authorization;

    if (authHeader) {
        token = authHeader.split(' ')[1];
    } else if (req.query.token) {
        token = req.query.token;
    }

    if (!token) return res.status(401).json({ message: 'No token provided' });
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        console.error('JWT Verification Error:', err.message);
        return res.status(401).json({ message: 'Invalid token: ' + err.message });
    }
};

exports.authorize = (role) => {
    return (req, res, next) => {
        if (req.user.role !== role && req.user.role !== 'ADMIN') { // Admin can access all usually, but stick to role
            if (req.user.role !== role) {
                return res.status(403).json({ message: 'Forbidden' });
            }
        }
        next();
    };
};
