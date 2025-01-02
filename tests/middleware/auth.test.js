const { isAuthenticated, isActive, isAdmin } = require('../../middleware/auth');

describe('Auth Middleware', () => {
    let mockReq;
    let mockRes;
    let nextFunction;

    beforeEach(() => {
        mockReq = {
            isAuthenticated: jest.fn(),
            user: {
                is_active: true,
                is_admin: false
            }
        };
        mockRes = {
            redirect: jest.fn(),
            status: jest.fn(() => mockRes),
            json: jest.fn()
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

    describe('isActive', () => {
        it('should call next() if user is active', () => {
            mockReq.user.is_active = true;
            
            isActive(mockReq, mockRes, nextFunction);
            
            expect(nextFunction).toHaveBeenCalled();
            expect(mockRes.status).not.toHaveBeenCalled();
        });

        it('should return error if user is not active', () => {
            mockReq.user.is_active = false;
            
            isActive(mockReq, mockRes, nextFunction);
            
            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith({ error: 'Account not activated' });
            expect(nextFunction).not.toHaveBeenCalled();
        });

        it('should return error if user is undefined', () => {
            mockReq.user = undefined;
            
            isActive(mockReq, mockRes, nextFunction);
            
            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith({ error: 'Account not activated' });
            expect(nextFunction).not.toHaveBeenCalled();
        });
    });

    describe('isAdmin', () => {
        it('should call next() if user is admin', () => {
            mockReq.user.is_admin = true;
            
            isAdmin(mockReq, mockRes, nextFunction);
            
            expect(nextFunction).toHaveBeenCalled();
            expect(mockRes.status).not.toHaveBeenCalled();
        });

        it('should return error if user is not admin', () => {
            mockReq.user.is_admin = false;
            
            isAdmin(mockReq, mockRes, nextFunction);
            
            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith({ error: 'Admin access required' });
            expect(nextFunction).not.toHaveBeenCalled();
        });

        it('should return error if user is undefined', () => {
            mockReq.user = undefined;
            
            isAdmin(mockReq, mockRes, nextFunction);
            
            expect(mockRes.status).toHaveBeenCalledWith(403);
            expect(mockRes.json).toHaveBeenCalledWith({ error: 'Admin access required' });
            expect(nextFunction).not.toHaveBeenCalled();
        });
    });
}); 