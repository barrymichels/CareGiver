# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands

```bash
# Development
npm run dev          # Start with nodemon for development
npm start           # Production start

# Testing
npm test            # Run Jest test suite
npm run test:watch  # Run tests in watch mode
npm run test:coverage # Generate coverage report

# Database
# Database files stored in ./data/ directory
# SQLite with WAL mode enabled for concurrency
```

## Architecture Overview

### Technology Stack
- **Backend**: Node.js, Express.js, SQLite3, EJS templates
- **Authentication**: Passport.js (Local + OAuth2/Authentik SSO)
- **Frontend**: Vanilla JavaScript (modular), Progressive Web App
- **Testing**: Jest with Supertest
- **Database**: SQLite with transaction support and retry logic

### Database Architecture

**Core Tables:**
- `users` - User accounts (supports virtual users without email/password)
- `availability` - Weekly time slot availability (dynamic slots per day)  
- `assignments` - Admin-assigned shifts with conflict tracking
- `user_preferences` - JSON-stored default availability preferences
- `timeslot_configurations` - Week-specific timeslot configurations
- `timeslots` - Individual timeslot definitions with time and labels
- `timeslot_templates` - Reusable timeslot templates for consistency
- `template_slots` - Template slot definitions

**Key Features:**
- DatabaseHelper class with retry logic for SQLite locking issues
- Transaction management with automatic rollback
- Week-based date calculations (Monday-Sunday weeks)
- Optimistic concurrency with UNIQUE constraints

### Authentication & Authorization

**Middleware Stack:**
- `isAuthenticated` - Basic auth check (redirects to login)
- `isAuthenticatedApi` - API auth check (returns 403 JSON)
- `isActive` - Account activation check
- `isAdmin` - Administrative privilege check

**OAuth2 Integration:**
- Authentik SSO support with PKCE and state parameters
- Automatic user creation from OAuth provider data
- Graceful fallback when OAuth disabled

### Route Organization

Routes follow factory pattern: `module.exports = function(db) { return router; }`

**Route Mounting:**
- `/` - Auth routes (login, register, logout)
- `/availability` - User availability management
- `/admin` - Administrative functions (user management, assignments)
- `/admin/timeslots` - Timeslot configuration management
- `/admin/timeslot-templates` - Template management and operations
- `/profile` - User profile management  
- `/users` - User CRUD operations
- `/` - Dashboard and main app functionality

### Frontend Architecture

**JavaScript Modules:**
- `availability.js` - Interactive availability grid with bulk operations
- `schedule-manager.js` - Admin schedule assignment with conflict detection
- `dashboard.js` - Dynamic time slot highlighting and mobile responsiveness
- `admin.js` - User management modals and workflows
- `users.js` - Real-time user status/role toggles
- `header.js` - Navigation with keyboard accessibility
- `auth.js` - Login/register tab switching
- `pwa.js` - Progressive Web App installation prompts
- `timeslot-manager.js` - Dynamic timeslot configuration interface

**Key Frontend Patterns:**
- Event-driven initialization with `DOMContentLoaded`
- Optimistic UI updates with server confirmation
- Dirty state tracking with unsaved changes protection
- Toast notifications for user feedback
- Comprehensive keyboard navigation support

**PWA Features:**
- Service worker with network-first/cache-first strategies
- Web app manifest with install prompts
- Offline fallback for static assets and cached content
- Mobile-optimized responsive design

### Date Handling Patterns

**Week Calculations:**
```javascript
// Monday-to-Sunday week start calculation using TimeslotManager
const timeslotManager = new TimeslotManager(db);
const weekStart = timeslotManager.getWeekStart(today);
```

**Dynamic Time Slots:**
- Flexible timeslots configurable per week by admins
- Template system for consistent timeslot configurations
- Automatic application of default template for new weeks
- Week offset functionality for viewing different weeks
- Dynamic time slot highlighting logic based on actual slots

### Flexible Timeslots System

**Overview:**
The application supports dynamic, per-week timeslot configuration allowing admins to customize schedules based on varying needs. This replaces the previous fixed 4-slot system.

**Core Components:**
- `TimeslotManager` - Central utility class for all timeslot operations
- `timeslot_configurations` - Week-specific configurations
- `timeslots` - Individual slot definitions (time, label, order)
- `timeslot_templates` - Reusable templates for consistency
- `template_slots` - Template slot definitions

**Key Features:**
- **Past Week Protection** - Only current and future weeks can be modified
- **Default Templates** - Automatic application of default template for new weeks
- **Conflict Detection** - Warns when changes affect existing availability/assignments
- **Template Management** - Create, apply, and manage reusable templates
- **Week Copying** - Copy timeslots from previous weeks
- **Validation** - Time format validation and duplicate prevention

**Admin Workflow:**
1. Navigate to "Configure Timeslots" from admin menu
2. Select week using navigation controls
3. Add/edit/remove timeslots for each day
4. Apply templates or copy from other weeks
5. Save configuration (with conflict warnings if applicable)

**Template System:**
- Create templates from existing week configurations
- Set default template for automatic application
- Apply templates to any future week
- Prevent deletion of default template

**Database Schema:**
```sql
-- Week-specific timeslot configuration
timeslot_configurations (id, week_start, created_by, created_at, updated_at)

-- Individual timeslots for each configuration
timeslots (id, config_id, day_of_week, time, label, slot_order)

-- Reusable templates
timeslot_templates (id, name, description, created_by, is_default, created_at)

-- Template slot definitions
template_slots (id, template_id, day_of_week, time, label, slot_order)
```

**Migration:**
- Existing data migrated to new schema with default template
- Backward compatibility maintained during transition
- Migration script: `migrations/001_flexible_timeslots.js`

**API Endpoints:**
- `GET /admin/timeslots` - Timeslot configuration page
- `POST /admin/timeslots` - Create/update configuration
- `POST /admin/timeslots/copy` - Copy from another week
- `GET /admin/timeslot-templates` - List templates
- `POST /admin/timeslot-templates` - Create template
- `POST /admin/timeslot-templates/:id/set-default` - Set default template

### Error Handling Patterns

**API Responses:**
- Success: `{ message: 'Description' }`
- Error: `{ error: 'Description' }`
- Consistent HTTP status codes (400, 401, 403, 404, 500)

**Database Operations:**
- Retry logic with exponential backoff for SQLite locking
- Transaction rollback on errors
- Promise wrapping for callback-based SQLite methods

### Security Considerations

**Input Validation:**
- Email format validation with regex
- Password minimum 8 characters
- Self-protection logic (users can't deactivate themselves)
- Input sanitization (trim, toLowerCase)

**Authentication:**
- bcrypt password hashing
- Secure session configuration with SQLite store
- CSRF protection through session-based auth
- Account activation workflow

### Development Guidelines

**Database Access:**
- Use `DatabaseHelper` class for new database operations
- Wrap multi-step operations in transactions
- Always handle SQLite locking scenarios with retry logic

**Route Development:**
- Follow consistent middleware stacking patterns
- Use appropriate authentication middleware for context
- Implement consistent error handling with try-catch blocks
- Return appropriate HTTP status codes and JSON/HTML responses

**Frontend Development:**
- Follow modular JavaScript patterns
- Implement accessibility features (keyboard navigation, ARIA labels)
- Use optimistic updates with server confirmation
- Add toast notifications for user feedback
- Ensure mobile responsiveness

**Testing:**
- Use Jest with Supertest for route testing
- Test with in-memory SQLite database (`config/test.db.js`)
- Test helper functions available in `tests/helpers/testHelpers.js`
- Comprehensive coverage for database operations and route handlers

### Environment Configuration

Required environment variables (see `.env.sample`):
- `SESSION_SECRET` - Session encryption key
- `DB_PATH` - SQLite database file path
- `PORT` - Server port (default 3000)
- OAuth2 variables (if Authentik integration enabled)
- SMTP configuration for password reset emails
- App branding variables (`APP_TITLE`, `APP_URL`)

### Virtual Users Feature

The application supports "virtual users" - users without email/password for non-tech-savvy family members:
- Created with just first name and last name
- Admins manage their availability directly
- Can be converted to regular users later
- Useful for family caregiving scenarios

### Calendar Integration

- iCal export functionality for assignments
- Calendar event generation with proper formatting
- Integration with external calendar applications