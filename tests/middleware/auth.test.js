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
        it('should call next() if user is admin', () => {
            mockReq.user = { is_admin: true };
            
            isAdmin(mockReq, mockRes, nextFunction);
            
            expect(nextFunction).toHaveBeenCalled();
            expect(mockRes.status).not.toHaveBeenCalled();
        });

        it('should return error if user is not admin', () => {
            mockReq.user = { is_admin: false };
            
            isAdmin(mockReq, mockRes, nextFunction);
            
            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith({ 
                error: 'Admin access required',
                user: mockReq.user 
            });
            expect(nextFunction).not.toHaveBeenCalled();
        });

        it('should return error if user is undefined', () => {
            mockReq.user = undefined;
            
            isAdmin(mockReq, mockRes, nextFunction);
            
            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith({ 
                error: 'Admin access required',
                user: undefined 
            });
            expect(nextFunction).not.toHaveBeenCalled();
        });
    });
}); 