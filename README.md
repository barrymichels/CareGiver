# CareGiver

CareGiver is a robust web-based scheduling application designed to manage user availability and shift assignments. Built with Node.js and Express, it provides a clean, intuitive interface for managing schedules and user assignments.

## Features

### User Management
- User authentication with email and password
- Role-based access control (Admin and Regular users)
- User activation/deactivation by administrators
- Secure password hashing using bcrypt
- Session management with SQLite storage

### Availability Management
- Users can set their availability for different time slots
- Interactive calendar interface
- Real-time availability updates
- Conflict detection and prevention
- Unsaved changes detection and warnings

### Schedule Management
- Administrators can assign users to time slots
- Automatic conflict detection
- Bulk assignment capabilities
- Filter and highlight assignments by user
- Mobile-responsive interface

### Administrative Features
- User account management
- Admin privilege management
- System setup and initialization
- User activation/deactivation
- Schedule oversight and management

## Technical Stack

- **Backend**: Node.js with Express
- **Database**: SQLite3 with WAL mode for better concurrency
- **Authentication**: Passport.js with local strategy
- **Session Management**: express-session with SQLite store
- **Frontend**: EJS templates with vanilla JavaScript
- **CSS**: Custom responsive design
- **Testing**: Jest with Supertest

## Installation

1. Clone the repository:
```bash
git clone https://github.com/barrymichels/CareGiver.git
cd CareGiver
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file in the root directory with the following variables:
```
NODE_ENV=development
PORT=3000
SESSION_SECRET=your_session_secret_here
DB_PATH=./data/database.sqlite
```

4. Initialize the application:
```bash
npm start
```

## Docker Deployment

The application can be deployed using Docker:

```bash
docker-compose up -d
```

This will:
- Build the application container
- Set up persistent volume for the database
- Start the application on port 3000

## Development

To run the application in development mode with hot reloading:

```bash
npm run dev
```

### Testing

Run the test suite:
```bash
npm test
```

Run tests with coverage:
```bash
npm run test:coverage
```

## Database Schema

### Users Table
- id (Primary Key)
- first_name
- last_name
- email (Unique)
- password (Hashed)
- is_admin
- is_active
- created_at

### Availability Table
- id (Primary Key)
- user_id (Foreign Key)
- day_date
- time_slot
- is_available
- created_at

### Assignments Table
- id (Primary Key)
- user_id (Foreign Key)
- day_date
- time_slot
- assigned_by (Foreign Key)
- created_at

### User Preferences Table
- user_id (Primary Key, Foreign Key)
- preferences

## Security Features

- Password hashing with bcrypt
- Session management with secure cookies
- SQL injection prevention through parameterized queries
- Input validation and sanitization
