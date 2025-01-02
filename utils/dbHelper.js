const sqlite3 = require('sqlite3');

class DatabaseHelper {
    constructor(db) {
        this.db = db;
    }

    async runWithRetry(sql, params = [], maxRetries = 5, delay = 100) {
        let lastError;
        
        for (let i = 0; i < maxRetries; i++) {
            try {
                return await new Promise((resolve, reject) => {
                    this.db.run(sql, params, function(err) {
                        if (err) {
                            if (err.code === 'SQLITE_BUSY') {
                                reject(err);
                            } else {
                                reject(err);
                            }
                        } else {
                            resolve(this);
                        }
                    });
                });
            } catch (error) {
                lastError = error;
                if (error.code !== 'SQLITE_BUSY' || i === maxRetries - 1) {
                    throw error;
                }
                await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
            }
        }
        
        throw lastError;
    }

    async beginTransaction() {
        await this.runWithRetry('BEGIN IMMEDIATE TRANSACTION');
    }

    async commit() {
        await this.runWithRetry('COMMIT');
    }

    async rollback() {
        try {
            await this.runWithRetry('ROLLBACK');
        } catch (error) {
            console.error('Error during rollback:', error);
        }
    }

    async withTransaction(callback) {
        await this.beginTransaction();
        try {
            const result = await callback();
            await this.commit();
            return result;
        } catch (error) {
            await this.rollback();
            throw error;
        }
    }
}

module.exports = DatabaseHelper; 