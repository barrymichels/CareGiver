function isAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    if (!req.user.is_active) {
      if (req.path === '/inactive') {
        return next();
      }
      if (req.path === '/logout') {
        return next();
      }
      return res.redirect('/inactive');
    }
    return next();
  }
  res.redirect('/login');
}

function isActive(req, res, next) {
  if (req.user?.is_active) {
    return next();
  }
  res.redirect('/inactive');
}

function isAdmin(req, res, next) {
    if (req.user?.is_admin) {
        return next();
    }
    res.status(403).send('Unauthorized');
}

module.exports = {
    isAuthenticated,
    isActive,
    isAdmin
}; 