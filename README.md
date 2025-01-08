# CareGiver

[Human content]
This is the only text I have provided for this project. The rest was generated by AI (including the commit messages).
This is a project to allow our family to manage the care giving schedule for our elderly parents.
It was built in just a few days as a way to fill a need and to learn how to utilize AI in app development.
It will grow and change as we use it and see how the app can be improved.
[/Human content]

## Key Features

### For Staff Members
- Set and update your availability with an interactive calendar
- Export your schedule to your preferred calendar app
- Get notifications for schedule conflicts
- Save default availability preferences

### For Administrators
- Easily assign staff to shifts with conflict detection
- Manage user accounts and permissions
- Monitor schedule coverage and conflicts
- Batch assign shifts with automatic validation
- Create and manage virtual users for non-tech-savvy staff
  - Add virtual users with just a name
  - Manage their availability directly
  - Convert virtual users to regular users when needed

## Quick Start

1. Install dependencies:
```bash
npm install
```

2. Set up environment:
- Copy `.env.sample` to `.env`
- Update required settings

3. Start the app:
```bash
npm start
```

For development:
```bash
npm run dev
```

## Docker Deployment

```bash
docker-compose up -d
```

See our [deployment guide](docs/deployment.md) for detailed instructions.

## Technical Details

- **Stack**: Node.js, Express, SQLite3, EJS templates
- **Security**: bcrypt password hashing, secure sessions, SQL injection prevention
- **Testing**: Jest with Supertest (`npm test`)

## Database Schema

### Core Tables
- Users (id, name, email, role)
- Availability (user_id, date, time_slot)
- Assignments (user_id, date, time_slot)
- Preferences (user_id, default_availability)
