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
    res.status(403).json({ error: 'Account not activated' });
}

const isAdmin = (req, res, next) => {
    if (req.user && req.user.is_admin) {
        next();
    } else {
        res.status(403).json({ 
            error: 'Admin access required',
            user: req.user 
        });
    }
};

module.exports = {
    isAuthenticated,
    isAuthenticatedApi,
    isActive,
    isAdmin
}; 