# Deployment Guide

This guide covers deploying CareGiver in both standard and Docker environments.

## Prerequisites

- Node.js 18+ (for standard deployment)
- Docker and Docker Compose (for containerized deployment)
- SMTP server credentials
- Authentik instance (optional)

## Standard Deployment

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd WayneScheduler
   ```

2. Install dependencies:
   ```bash
   npm install --production
   ```

3. Configure environment:
   ```bash
   cp .env.sample .env
   ```
   Edit `.env` and set:
   - `PORT`: Application port (default: 3000)
   - `SESSION_SECRET`: Long random string
   - `DB_PATH`: SQLite database location
   - SMTP settings for email notifications
   - Authentik settings (if using SSO)

4. Start the application:
   ```bash
   npm start
   ```

5. (Optional) Use PM2 for process management:
   ```bash
   npm install -g pm2
   pm2 start app.js --name caregiver
   pm2 save
   ```

## Docker Deployment

1. Configure environment:
   ```bash
   cp .env.sample .env
   ```
   Edit as described above.

2. Start with Docker Compose:
   ```bash
   docker-compose up -d
   ```

3. View logs:
   ```bash
   docker-compose logs -f
   ```

## Nginx Configuration

If using Nginx as a reverse proxy:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## SSL/TLS Setup

1. Install Certbot
2. Obtain certificate:
   ```bash
   certbot --nginx -d your-domain.com
   ```

## Backup Strategy

1. Database backup:
   ```bash
   cp data/database.sqlite data/database.backup.sqlite
   ```

2. For automated backups, create a cron job:
   ```bash
   0 0 * * * cp /path/to/data/database.sqlite /path/to/backups/database.$(date +%Y%m%d).sqlite
   ```

## Monitoring

1. Basic status check:
   ```bash
   curl http://localhost:3000/health
   ```

2. Use PM2 monitoring:
   ```bash
   pm2 monit
   ```

## Troubleshooting

- Check logs: `npm run logs` or `docker-compose logs`
- Verify database permissions
- Ensure all required ports are open
- Check SMTP settings if emails aren't sending

## Security Considerations

- Keep Node.js and npm packages updated
- Regularly rotate session secrets
- Use strong passwords
- Enable rate limiting in production
- Set secure headers (already configured)
- Regular security audits

## Updates

1. Standard deployment:
   ```bash
   git pull
   npm install
   npm run build
   pm2 restart all
   ```

2. Docker deployment:
   ```bash
   docker-compose pull
   docker-compose up -d
   ``` 