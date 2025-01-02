function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect('/login');
}

function isActive(req, res, next) {
    if (req.user && req.user.is_active) {
        return next();
    }
    res.status(403).json({ error: 'Account not activated' });
}

function isAdmin(req, res, next) {
    if (req.user && req.user.is_admin) {
        return next();
    }
    res.status(403).json({ error: 'Admin access required' });
}

module.exports = {
    isAuthenticated,
    isActive,
    isAdmin
}; 