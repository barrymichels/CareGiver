function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.redirect('/login');
}

function isAuthenticatedApi(req, res, next) {
    if (req.isAuthenticated()) {
        return next();
    }
    res.status(403).json({ error: 'Authentication required' });
}

function isActive(req, res, next) {
    if (req.user && req.user.is_active) {
        return next();
    }
    if (req.path === '/export-calendar') {
        return res.status(403).json({ error: 'Account not activated' });
    }
    return res.redirect('/inactive');
}

const isAdmin = (req, res, next) => {
    // is_active belongs in this check, not just is_admin: not one of the /admin* routes
    // stacks isActive, so an admin gate that trusts is_admin alone would hand a full
    // admin session to an account every other page correctly refuses.
    if (req.user && req.user.is_admin && req.user.is_active) {
        next();
    } else {
        // Never include req.user here: it is a full `SELECT *` row and would
        // reflect the caller's password hash and reset token back to them.
        res.status(403).json({
            error: 'Admin access required'
        });
    }
};

module.exports = {
    isAuthenticated,
    isAuthenticatedApi,
    isActive,
    isAdmin
}; 