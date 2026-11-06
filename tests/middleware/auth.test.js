const { isAuthenticated, isAuthenticatedApi, isActive, isAdmin } = require('../../middleware/auth');

describe('Auth Middleware', () => {
    let mockReq;
    let mockRes;
    let nextFunction;

    beforeEach(() => {
        mockReq = {
            isAuthenticated: jest.fn(),
            path: '/'
        };
        mockRes = {
            status: jest.fn(() => mockRes),
            json: jest.fn(() => mockRes),
            redirect: jest.fn()
        };
        nextFunction = jest.fn();
    });

    describe('isAuthenticated', () => {
        it('should call next() if user is authenticated', () => {
            mockReq.isAuthenticated.mockReturnValue(true);
            
            isAuthenticated(mockReq, mockRes, nextFunction);
            
            expect(nextFunction).toHaveBeenCalled();
            expect(mockRes.redirect).not.toHaveBeenCalled();
        });

        it('should redirect to login if user is not authenticated', () => {
            mockReq.isAuthenticated.mockReturnValue(false);
            
            isAuthenticated(mockReq, mockRes, nextFunction);
            
            expect(mockRes.redirect).toHaveBeenCalledWith('/login');
            expect(nextFunction).not.toHaveBeenCalled();
        });
    });

    describe('isAuthenticatedApi', () => {
        it('should call next() if user is authenticated', () => {
            mockReq.isAuthenticated.mockReturnValue(true);
            
            isAuthenticatedApi(mockReq, mockRes, nextFunction);
            
            expect(nextFunction).toHaveBeenCalled();
            expect(mockRes.status).not.toHaveBeenCalled();
        });

        it('should return 403 if user is not authenticated', () => {
            mockReq.isAuthenticated.mockReturnValue(false);
            
            isAuthenticatedApi(mockReq, mockRes, nextFunction);
            
            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith({ error: 'Authentication required' });
            expect(nextFunction).not.toHaveBeenCalled();
        });
    });

    describe('isActive', () => {
        it('should call next() if user is active', () => {
            mockReq.user = { is_active: true };
            
            isActive(mockReq, mockRes, nextFunction);
            
            expect(nextFunction).toHaveBeenCalled();
            expect(mockRes.redirect).not.toHaveBeenCalled();
            expect(mockRes.status).not.toHaveBeenCalled();
        });

        it('should return error for API routes if user is not active', () => {
            mockReq.user = { is_active: false };
            mockReq.path = '/export-calendar';
            
            isActive(mockReq, mockRes, nextFunction);
            
            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith({ error: 'Account not activated' });
            expect(nextFunction).not.toHaveBeenCalled();
        });

        it('should redirect for UI routes if user is not active', () => {
            mockReq.user = { is_active: false };
            mockReq.path = '/dashboard';
            
            isActive(mockReq, mockRes, nextFunction);
            
            expect(mockRes.redirect).toHaveBeenCalledWith('/inactive');
            expect(mockRes.status).not.toHaveBeenCalled();
            expect(nextFunction).not.toHaveBeenCalled();
        });

        it('should redirect if user is undefined', () => {
            mockReq.user = undefined;
            mockReq.path = '/dashboard';
            
            isActive(mockReq, mockRes, nextFunction);
            
            expect(mockRes.redirect).toHaveBeenCalledWith('/inactive');
            expect(mockRes.status).not.toHaveBeenCalled();
            expect(nextFunction).not.toHaveBeenCalled();
        });
    });

    describe('isAdmin', () => {
        it('should call next() if user is an active admin', () => {
            // is_active belongs in the fixture: an admin who has been deactivated must
            // not pass, so the middleware's contract is admin AND active.
            mockReq.user = { is_admin: true, is_active: true };
            
            isAdmin(mockReq, mockRes, nextFunction);
            
            expect(nextFunction).toHaveBeenCalled();
            expect(mockRes.status).not.toHaveBeenCalled();
        });

        it('should return error if user is not admin', () => {
            mockReq.user = { is_admin: false, is_active: true };
            
            isAdmin(mockReq, mockRes, nextFunction);
            
            expect(mockRes.status).toHaveBeenCalledWith(403);
            // Regression guard: the 403 body must not carry the user record,
            // which contains the password hash and any live reset token.
            expect(mockRes.json).toHaveBeenCalledWith({
                error: 'Admin access required'
            });
            expect(nextFunction).not.toHaveBeenCalled();
        });

        it('should return error if user is undefined', () => {
            mockReq.user = undefined;
            
            isAdmin(mockReq, mockRes, nextFunction);
            
            expect(mockRes.status).toHaveBeenCalledWith(403);
            // toEqual ignores undefined-valued keys, so asserting `{ error, user: undefined }`
            // would pass even if a `user` key holding the full row were echoed back.
            // Assert the body's exact key set instead.
            expect(Object.keys(mockRes.json.mock.calls[0][0])).toEqual(['error']);
            expect(nextFunction).not.toHaveBeenCalled();
        });

        it('should return error if user is an admin but deactivated', () => {
            // The scenario this guard exists for: isAdmin used to be the only admin gate
            // on the /admin* routes and checked is_admin alone, so a deactivated admin -
            // bounced by isActive everywhere else - kept full admin access wherever
            // isActive was forgotten (which was all 26 /admin* routes).
            mockReq.user = { is_admin: 1, is_active: 0 };

            isAdmin(mockReq, mockRes, nextFunction);

            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith({ error: 'Admin access required' });
            expect(nextFunction).not.toHaveBeenCalled();
        });
    });
}); 