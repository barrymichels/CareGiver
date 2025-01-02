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

const isAdmin = (req, res, next) => {
    if (req.user && req.user.is_admin) {
        next();
    } else {
        res.status(403).render('error', { 
            message: 'Access denied', 
            user: req.user 
        });
    }
};

module.exports = {
    isAuthenticated,
    isActive,
    isAdmin
}; 